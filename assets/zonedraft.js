/* Zone auto-draft — shared by the Zone Planner page and tools/zone_autofill.js (claude/62).
 *
 * Given a CobbleZones zone file and the species pool (data/zonepool.json), picks a themed,
 * level-appropriate encounter table. Deterministic: the same zone, settings and seed always
 * give the same draft, so a re-run only changes what you asked it to change.
 *
 *   ZoneDraft.inferTags(zone)        -> ["forest", ...]   from the zone's name / dimension
 *   ZoneDraft.inferLevels(zone)      -> [min, max]        from the route progression below
 *   ZoneDraft.isFishing(zone)        -> bool              name says fishing, or mode FISHING
 *   ZoneDraft.draft(zone, pool, opt) -> encounter entries in CobbleZones' own format
 */
(function (root) {
  "use strict";

  // what each theme likes, by type (0..1). A species must share at least one type with a
  // zone's themes to be drafted there.
  const TAGS = {
    meadow:     { normal: 1, grass: .9, bug: .8, flying: .8, fairy: .5, electric: .35, ground: .3 },
    forest:     { bug: 1, grass: 1, poison: .6, normal: .5, fairy: .5, flying: .45, dark: .3 },
    cave:       { rock: 1, ground: .9, dark: .6, steel: .6, poison: .5, ghost: .3, dragon: .25 },
    mountain:   { rock: 1, ground: .8, flying: .7, fighting: .7, ice: .3, dragon: .3 },
    volcano:    { fire: 1, rock: .8, ground: .7, steel: .3, dragon: .3, poison: .2 },
    graveyard:  { ghost: 1, dark: .8, poison: .5, psychic: .3, normal: .2 },
    beach:      { water: 1, ground: .7, flying: .5, rock: .4, normal: .4, bug: .2 },
    ocean:      { water: 1, ice: .3, dragon: .15, poison: .2 },
    lake:       { water: 1, bug: .3, grass: .3, flying: .3, poison: .2 },
    island:     { grass: .8, water: .7, bug: .6, flying: .6, normal: .4 },
    lighthouse: { electric: 1, steel: .7, water: .6, flying: .6, normal: .3 },
    city:       { normal: 1, electric: .7, poison: .6, steel: .5, psychic: .4, fighting: .4 },
    lab:        { electric: 1, steel: .8, psychic: .8, normal: .5, poison: .4 },
    garden:     { grass: 1, bug: .8, normal: .7, fairy: .7, flying: .4 },
    lumbermill: { bug: .9, grass: .9, fighting: .7, normal: .6, steel: .3 },
    pavilion:   { normal: .8, fairy: .8, psychic: .7, grass: .6, fighting: .4 },
    sky:        { flying: 1, fairy: .8, psychic: .7, dragon: .5, ice: .4, normal: .3 },
    snow:       { ice: 1, water: .4, normal: .3, steel: .3 },
    desert:     { ground: 1, rock: .7, fire: .6, bug: .4, dark: .4 },
    swamp:      { poison: 1, water: .7, grass: .6, bug: .5, ghost: .3 },
    ruins:      { psychic: 1, ghost: .7, rock: .6, steel: .5, dragon: .3 },
    nether:     { fire: 1, dark: .8, ghost: .7, rock: .6, ground: .5, steel: .3 },
    void:       { psychic: 1, dragon: .9, ghost: .8, dark: .8, poison: .4, steel: .3 },
  };
  // an alternate form whose aspect fits the place gets a bonus there
  const ASPECT_TAG = { aether: "sky", nether: "volcano", scorched: "volcano", hydrothermal: "ocean",
    kelp: "ocean", frosty: "snow", winter: "snow", snowman: "snow", tomb: "graveyard",
    eerie: "graveyard", goth: "graveyard", midnight: "graveyard", overgrown: "forest",
    hay: "meadow", ender: "cave", monolith: "ruins", clockwork: "lab" };

  // name keywords -> themes (checked in order; several may apply)
  const NAME_TAGS = [
    [/forest|woods|grove|jungle/, "forest"],
    [/cave|mine|depths|nexus|tunnel|cavern|sewer/, "cave"],
    [/igneus|volcan|magma|lava|crater/, "volcano"],
    [/mount|cliff|summit|peak|ridge/, "mountain"],
    [/grave|cemetery|tomb|crypt|manor|haunt/, "graveyard"],
    [/beach|shore|coast/, "beach"],
    [/ocean|sea|atoll|deep|bay|reef/, "ocean"],
    [/lake|lagoon|pond|river/, "lake"],
    [/island|isle/, "island"],
    [/lighthouse/, "lighthouse"],
    [/lab/, "lab"],
    [/backyard|garden|park/, "garden"],
    [/lumber|mill|sawmill/, "lumbermill"],
    [/pavilion|plaza/, "pavilion"],
    [/snow|frost|ice|glacier/, "snow"],
    [/desert|dune|aredia/, "desert"],
    [/swamp|marsh|bog/, "swamp"],
    [/ruin|temple|shrine/, "ruins"],
    [/city|town/, "city"],
  ];

  // the route order of Region of Roria, as the zones are named. [pattern, levelMin, levelMax]
  // First match wins, so specific sub-areas come before their area.
  const LEVELS = [
    [/professor|backyard/, 2, 4],
    [/route1(?!\d)/, 2, 5],
    [/mitis/, 3, 6],
    [/chesma|cheshma/, 4, 8],
    [/route2(?!\d)/, 4, 7],
    [/galeforestlower/, 6, 9],
    [/galeforest/, 8, 11],
    [/route3(?!\d)/, 8, 12],
    [/silvent/, 10, 13],
    [/route4(?!\d)/, 11, 14],
    [/route5(?!\d)/, 13, 17],
    [/graveyard/, 15, 18],
    [/route6(?!\d)/, 16, 20],
    [/igneus(depths|nexus|summit)/, 21, 26],
    [/igneus/, 18, 24],
    [/mineshaft/, 20, 24],
    [/route7(?!\d)/, 22, 26],
    [/lagoona/, 23, 27],
    [/routeae1/, 26, 30],
    [/routeae2summit/, 32, 36],
    [/routeae2/, 29, 34],
    [/route8(?!\d)/, 27, 31],
    [/rosecovedeep/, 34, 38],
    [/rosecove/, 30, 35],
  ];

  const WATER_EGGS = ["Water 1", "Water 2", "Water 3"];
  const RARITIES = [["Common", 55], ["Uncommon", 30], ["Rare", 12], ["Very Rare", 3]];
  // glitch Pokémon live in a category of their own: about 1 encounter in 2,000, and never one of
  // the zone's normal slots (the user, 2026-09-28)
  const GLITCH = ["Glitch", 0.05];
  const SHARE = [0.4, 0.3, 0.2, 0.1];      // share of a zone's slots per rarity tier

  const key = z => String((z && z.name) || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function isFishing(zone) {
    return zone.mode === "FISHING" || /fishing/.test(key(zone));
  }

  function inferTags(zone) {
    const k = key(zone), out = [];
    if (String(zone.dimension || "").startsWith("aether:")) out.push("sky");
    if (zone.dimension === "minecraft:the_nether") out.push("nether");
    if (zone.dimension === "minecraft:the_end") out.push("void");
    for (const [re, tag] of NAME_TAGS) if (re.test(k) && !out.includes(tag)) out.push(tag);
    if (isFishing(zone)) {
      const wet = out.filter(t => t === "ocean" || t === "lake");
      if (!wet.length) out.push(/rosecove|beach|island|atoll|ocean|sea/.test(k) ? "ocean" : "lake");
      return out.filter(t => ["ocean", "lake", "swamp", "volcano", "snow", "sky"].includes(t));
    }
    if (out.includes("city") && out.length > 1) out.splice(out.indexOf("city"), 1);
    if (!out.length) out.push("meadow");
    return out;
  }

  function inferLevels(zone) {
    const k = key(zone);
    for (const [re, a, b] of LEVELS) if (re.test(k)) return [a, b];
    const m = k.match(/route(\d+)/);
    if (m) { const n = +m[1]; return [Math.round(2 + 3.4 * n), Math.round(5 + 3.4 * n)]; }
    return [10, 15];
  }

  // small seeded RNG so drafts are repeatable
  function rng(seedStr) {
    let h = 2166136261;
    for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5; let t = h;
      t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // the first theme is the zone's main character; later ones count for less
  const TAG_RANK = [1, 0.6, 0.45, 0.35];
  const fit = (ty, tags) => tags.reduce((m, tg, i) =>
    Math.max(m, ((TAGS[tg] || {})[ty] || 0) * (TAG_RANK[i] || 0.3)), 0);

  function themeScore(types, tags) {
    let s = 0;
    types.forEach((ty, i) => { s += fit(ty, tags) * (i === 0 ? 1 : 0.6); });
    return s;
  }

  // every species / wild form that could go in this zone, with a weight
  function candidates(zone, pool, opt) {
    const tags = opt.tags || inferTags(zone);
    const [lmin, lmax] = opt.levels || inferLevels(zone);
    const fishing = opt.fishing != null ? opt.fishing : isFishing(zone);
    const cap = Math.min(650, 280 + 7 * lmax);
    const out = [];
    for (const sp of pool) {
      if (sp.x && !opt.allowSkipped) continue;
      if (sp.g && !opt.glitch) continue;
      if (sp.l > lmax) continue;
      const variants = [{ t: sp.t, b: sp.b, a: [], n: "" }].concat(
        (sp.fm || []).map(f => ({ t: f.t, b: f.b, a: f.a, n: f.n })));
      for (const v of variants) {
        if (v.b > cap) continue;
        if (fishing && !v.t.includes("water") && !sp.eg.some(e => WATER_EGGS.includes(e))) continue;
        // it has to belong here: one of its types must be a real fit (>= .5) for a theme
        if (!v.t.some(ty => fit(ty, tags) >= 0.4)) continue;
        let w = themeScore(v.t, tags);
        if (sp.nx && sp.nx <= lmin) w *= 0.35;           // would have evolved by now
        if (v.b > cap - 40) w *= 0.6;                    // strong for the area
        if (v.a.length) {
          const bonus = v.a.some(a => tags.includes(ASPECT_TAG[a]));
          w *= bonus ? 1.6 : (/(alolan|galarian|hisuian|paldean)/.test(v.a.join()) ? 0.6 : 0.2);
        }
        if (sp.fo) w *= 0.5;                              // fossils: in the mix, but a find
        const used = (opt.usage && opt.usage[sp.sid || sp.id]) || 0;
        w /= 1 + 0.8 * used;
        out.push({ sp, v, w });
      }
    }
    return out;
  }

  function rarityOf(entries) {
    // commoner = higher catch rate, lower BST
    const ranked = entries.slice().sort((a, b) => (b.sp.c / b.v.b) - (a.sp.c / a.v.b));
    const n = ranked.length, cut = [];
    let acc = 0;
    SHARE.forEach(s => { acc += s; cut.push(Math.round(acc * n)); });
    ranked.forEach((e, i) => { e.rarity = RARITIES[cut.findIndex(c => i < c)][0]; });
    if (n >= 4 && !ranked.some(e => e.rarity === "Very Rare")) ranked[n - 1].rarity = "Very Rare";
    // a fossil is never Common or Uncommon
    ranked.forEach(e => { if (e.sp.fo && (e.rarity === "Common" || e.rarity === "Uncommon")) e.rarity = "Rare"; });
  }

  function entry(sp, v, rarity, lmin, lmax) {
    const lo = Math.max(lmin, sp.l), hi = Math.max(lo, lmax);
    return { enabled: true, species: sp.sid || sp.id, form: "", aspects: v.a.slice(), rarityCategory: rarity,
             spawnGroupMin: 0, spawnGroupMax: 0, shinyChancePercent: 0.0, levelMin: lo, levelMax: hi,
             timeWindow: "ANY", weatherCondition: "ANY", gender: "", nature: "", heldItems: [] };
  }

  /* opt: { tags, levels:[min,max], count, seed, usage:{id:n}, keep:[entries], allowSkipped, fishing }
     `keep` entries stay and count toward the total; their families are not drafted again. */
  function draft(zone, pool, opt) {
    opt = opt || {};
    const [lmin, lmax] = opt.levels || inferLevels(zone);
    const fishing = opt.fishing != null ? opt.fishing : isFishing(zone);
    const count = opt.count || (fishing ? 7 : 10);
    const keep = opt.keep || [];
    const isGlitch = e => e.rarityCategory === GLITCH[0];
    const normalKept = keep.filter(e => !isGlitch(e)).length;
    const rand = rng(`${key(zone)}|${opt.seed || 0}`);
    const byId = {};
    pool.forEach(s => { byId[s.id] = s; if (s.sid) byId[s.sid] = s; });
    const famTaken = new Set(keep.map(e => (byId[e.species] || {}).fam || e.species));
    let cands = candidates(zone, pool, opt).filter(c => !famTaken.has(c.sp.fam));
    // at most one fossil per zone
    if (keep.some(e => (byId[e.species] || {}).fo)) cands = cands.filter(c => !c.sp.fo);
    const picked = [];
    while (picked.length + normalKept < count && cands.length) {
      const total = cands.reduce((s, c) => s + c.w, 0);
      let r = rand() * total, i = 0;
      while (i < cands.length - 1 && (r -= cands[i].w) > 0) i++;
      const c = cands[i];
      picked.push(c);
      cands = cands.filter(x => x.sp.fam !== c.sp.fam && !(c.sp.fo && x.sp.fo));
    }
    rarityOf(picked);
    const out = keep.concat(picked.map(c => entry(c.sp, c.v, c.rarity, lmin, lmax)));
    // one glitch bonus per walking zone, unless one is already kept
    if (!fishing && opt.glitchSlot !== false && !keep.some(isGlitch)) {
      const gl = pool.filter(s => s.g && !s.x && s.l <= lmax);
      if (gl.length) {
        const g = gl[Math.floor(rand() * gl.length)];
        out.push(entry(g, { a: [] }, GLITCH[0], lmin, lmax));
      }
    }
    return out;
  }

  // re-rank a whole table's normal slots (after some were swapped out), glitch slot untouched
  function rerank(encounters, pool) {
    const byId = {};
    pool.forEach(s => { byId[s.id] = s; if (s.sid) byId[s.sid] = s; });
    const rows = encounters.filter(e => e.rarityCategory !== GLITCH[0] && byId[e.species])
      .map(e => { const sp = byId[e.species]; const f = (sp.fm || []).find(f => f.a.join() === (e.aspects || []).join());
                  return { e, sp, v: { b: f ? f.b : sp.b } }; });
    rarityOf(rows);
    rows.forEach(r => { r.e.rarityCategory = r.rarity; });
    return encounters;
  }

  function rarities() { return RARITIES.concat([GLITCH]).map(([name, weight]) => ({ name, weight })); }

  const api = { GLITCH, rerank, TAGS, inferTags, inferLevels, isFishing, candidates, draft, rarities, themeScore,
                zoneKey: key };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZoneDraft = api;
})(typeof window !== "undefined" ? window : globalThis);
