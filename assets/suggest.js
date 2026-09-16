/* Team suggester — propose six Pokémon, with items and movesets, from a few choices.
 *
 * There is no tier list in here and there deliberately isn't going to be one. This pack
 * holds 2362 species, most of them from addons nobody has ever ranked, so any imported
 * tiering would cover the official 1025 and silently rate every fakemon as unplayable.
 * Everything below is scored from data the wiki already has — base stats, types, and the
 * species' own learnset — which works the same for Cobblemon's Garchomp and for a pack's
 * invented starter.
 *
 * The scoring, in order of weight:
 *
 *   1. **Level band** sets the base-stat total the picker aims at, because a level-15
 *      route trainer holding a 600 BST pseudo-legendary is not a difficulty setting, it is
 *      a wall. Distance from the target BST is the first-order penalty.
 *   2. **Type theme**, if one is chosen: a strong bonus for having the type, and the team
 *      still needs to cover what that type cannot hit.
 *   3. **Role balance**: each pick claims the role its own stats point at — a physical
 *      attacker, a special attacker, a wall, a pivot — and a role already filled is worth
 *      much less than one that is empty. This is what stops six sweepers.
 *   4. **Coverage**: how much of the type chart the team can already hit for super
 *      effective damage, computed from the moves each candidate actually learns.
 *
 * The gimmick gate is a hard filter, not a score. If Megas are off, a Mega form is never
 * offered and no mega stone is ever held — "no Megas" has to mean none.
 */
(function () {
  "use strict";

  const D = () => window.DEX;
  const TB = () => window.TeamBuilder;

  /* The type chart, attacker -> defender multipliers. Only the non-1 entries. Custom types
   * that packs invent (crystal, sound, nuclear…) have no chart, so they score as neutral —
   * which is the honest answer, not a guess. */
  const CHART = {
    normal: { rock: .5, ghost: 0, steel: .5 },
    fire: { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
    water: { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
    electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
    grass: { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5,
             rock: 2, dragon: .5, steel: .5 },
    ice: { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
    fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2,
                ghost: 0, dark: 2, steel: 2, fairy: .5 },
    poison: { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
    flying: { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
    psychic: { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
    bug: { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5,
           dark: 2, steel: .5, fairy: .5 },
    rock: { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: .5 },
    dragon: { dragon: 2, steel: .5, fairy: 0 },
    dark: { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
    steel: { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
    fairy: { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
  };
  const DEFENDERS = Object.keys(CHART);

  /* The presets are SHORTCUTS, not the setting. On a real server no two gym leaders are the
   * same level, so the level is a number the user types and everything follows from it;
   * picking a preset just fills the boxes in. */
  const BANDS = [
    { id: "early", label: "Early route", lvl: 18, min: 1, max: 3 },
    { id: "mid", label: "Mid game", lvl: 35, min: 3, max: 4 },
    { id: "gym", label: "Gym leader", lvl: 50, min: 6, max: 6 },
    { id: "late", label: "Late game", lvl: 65, min: 4, max: 6 },
    { id: "elite", label: "Elite Four", lvl: 78, min: 6, max: 6 },
    { id: "champion", label: "Champion", lvl: 88, min: 6, max: 6 },
  ];

  /* Level -> the base-stat total to aim at. The anchors are the preset bands, which held up
   * in testing (an early-route team came out 336-350 BST across 25 runs); everything between
   * them is interpolated, so level 23 and level 27 really do draw on different pools. Above
   * the last anchor it flattens: nothing in the game is meaningfully stronger than 600 by
   * stat total alone. */
  const CURVE = [[1, 250], [18, 340], [35, 420], [50, 480], [65, 520], [78, 570], [88, 600],
                 [100, 600]];
  function bstFor(level) {
    const L = Math.max(1, Math.min(100, level || 1));
    for (let i = 1; i < CURVE.length; i++) {
      const [x0, y0] = CURVE[i - 1], [x1, y1] = CURVE[i];
      if (L <= x1) return Math.round(y0 + (y1 - y0) * ((L - x0) / (x1 - x0)));
    }
    return CURVE[CURVE.length - 1][1];
  }

  const ROLES = ["physical", "special", "wall", "pivot"];

  const S = {
    theme: "", packs: "all", roles: true, mega: false, gmax: false,
    level: 50, sizeMin: 6, sizeMax: 6,
  };

  /* Rolled fresh on EVERY press, not once when a preset is chosen. The first version put a
   * single rolled number into one box, so a preset that said "1-3 mons" picked (say) 2 and
   * then every subsequent press gave exactly 2 — the range was a label, not a behaviour. */
  function rollSize() {
    const lo = Math.max(1, Math.min(6, +S.sizeMin || 1));
    const hi = Math.max(lo, Math.min(6, +S.sizeMax || lo));
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /* --------------------------------------------------------------- roles */
  /** What a species is FOR, from its own stats. Not a label anyone assigned — the spread
   *  is the only thing that generalises across 2362 species from 124 packs. */
  function roleOf(s) {
    const atk = s.attack, spa = s.special_attack;
    const bulk = s.hp + s.defence + s.special_defence;
    const off = Math.max(atk, spa);
    if (bulk >= off * 2.6) return "wall";
    if (s.speed >= 95 && off >= 95) return atk >= spa ? "physical" : "special";
    if (bulk >= off * 1.9) return "pivot";
    return atk >= spa ? "physical" : "special";
  }

  function effect(att, def) {
    const row = CHART[String(att).toLowerCase()];
    if (!row) return 1;                       // a custom type has no chart — treat as neutral
    let m = 1;
    (def || []).forEach(d => {
      const v = row[String(d).toLowerCase()];
      if (v != null) m *= v;
    });
    return m;
  }

  /** How many of the 18 chart types this set of attacking types hits for 2x or better. */
  function coverage(types) {
    let n = 0;
    DEFENDERS.forEach(d => {
      if (types.some(t => effect(t, [d]) >= 2)) n++;
    });
    return n;
  }

  /* ------------------------------------------------------------- picking */
  async function suggest(onProgress) {
    const level = Math.max(1, Math.min(100, +S.level || 1));
    const band = { lvl: level, bst: bstFor(level) };
    const theme = S.theme;
    const idx = D().DB.index;

    // ---- the candidate pool -------------------------------------------------
    let pool = idx.filter(r => {
      if (!r.s || !r.b) return false;
      if (S.packs === "official" && !r.v) return false;
      if (S.packs === "custom" && r.v) return false;
      // A HARD gate, not a score. `l` is the earliest level this species can exist at,
      // walked from its own evolution chain by wiki_data.py — Charizard 36, Gyarados 20,
      // Garchomp 48. A level-18 trainer cannot have a Charizard, however well it scores,
      // because the player could not have one either.
      if ((r.l || 1) > level) return false;
      return true;
    });
    if (theme) pool = pool.filter(r => (r.t || []).some(t => t.toLowerCase() === theme));
    if (!pool.length) return { team: [], why: ["Nothing in the dex matches those filters."] };

    // ---- score, then take the best six that also balance ---------------------
    const scored = pool.map(r => {
      const gap = Math.abs(r.b - band.bst);
      let sc = 1000 - gap * 1.6;
      if (theme && (r.t || [])[0] && r.t[0].toLowerCase() === theme) sc += 40;
      // Having a Mega is NOT a reason to pick a species, in either direction. It used to be
      // +35 with the gimmick on, which stacked all six slots with mega-capable species when
      // only one can ever use it, and -10 with it off, which penalised a perfectly good
      // Pokemon for a form the team was not going to use. The gimmick decides what a pick
      // may DO, never who gets picked.
      sc += Math.random() * 60;                 // two runs should not be identical
      return { row: r, score: sc, role: roleOf(r.s) };
    }).sort((a, b) => b.score - a.score);

    const want = rollSize();
    const picked = [], used = new Set(), roleCount = {};
    const have = [];                             // attacking types the team already has
    // Role caps have to scale with the team, or a three-Pokemon team can never satisfy
    // "every role filled" and the gate rejects everything after the first of each.
    const perRole = Math.max(1, Math.ceil(want / 3));
    const needRoles = Math.min(ROLES.length, want);
    for (const c of scored) {
      if (picked.length >= want) break;
      if (used.has(c.row.id)) continue;
      if (S.roles) {
        const n = roleCount[c.role] || 0;
        const filled = ROLES.filter(r => (roleCount[r] || 0) > 0).length;
        if (n >= perRole && filled < needRoles) continue;
        if (n >= perRole + 1) continue;
      }
      // prefer a pick that adds type coverage the team lacks
      const before = coverage(have);
      const after = coverage(have.concat((c.row.t || []).map(t => t.toLowerCase())));
      if (picked.length >= 2 && after === before && Math.random() < 0.6) continue;
      picked.push(c);
      used.add(c.row.id);
      roleCount[c.role] = (roleCount[c.role] || 0) + 1;
      (c.row.t || []).forEach(t => have.push(String(t).toLowerCase()));
    }

    /* ---- exactly ONE Mega on the team -----------------------------------------
     * Mega Showdown's own config decides this, not a guess: `multipleMegas` is declared
     * in MegaShowdownConfig and its static initialiser stores `iconst_0` into it, so the
     * default is FALSE — a trainer Mega Evolves once per battle. Handing six Pokemon a
     * mega stone therefore builds one Mega and five Pokemon holding a dead item, since a
     * stone does nothing else.
     *
     * Cobblemon's `battle_bond` forms are NOT this. Ash-Greninja and Bond Greninja are
     * choices of the `battle_bond` species_feature with `mega: false` and no stone, so
     * they transform without touching the Mega slot — which is why a Mega Greninja and an
     * Ash-Greninja are different things. (This pack has both: three Mega Greninja forms
     * on `ashgreninjite`, and the two Battle Bond forms.)
     *
     * Gigantamax is capped at one the same way. MSD has no `multipleDynamax` flag to read,
     * so unlike the Mega rule this is not proven from its files — but the games allow one
     * per battle and a second Gmax adds nothing either way.
     */
    // ALLOW, not REQUIRE. An earlier version swapped the weakest pick for a mega-capable
    // species whenever the roll produced none, which quietly turned the checkbox into
    // "always include a Mega" — ten teams in a row had one. The checkbox opens the door:
    // if a Pokemon that happens to be on the team can Mega Evolve, one of them does.
    // Nothing is substituted to make that happen.
    const aceIdx = { mega: -1, gmax: -1 };
    if (S.mega) aceIdx.mega = picked.findIndex(c => c.row.m > 0);
    if (S.gmax) aceIdx.gmax = 0;      // resolved per-pick below; first that has one wins

    // ---- turn each pick into a filled slot ------------------------------------
    const slots = [];
    const notes = [];
    let gaveMega = false, gaveGmax = false;
    for (let i = 0; i < 6; i++) {
      const c = picked[i];
      if (!c) { slots.push(null); continue; }
      if (onProgress) onProgress(i + 1, picked.length, c.row.n);
      const may = {
        mega: S.mega && i === aceIdx.mega && !gaveMega,
        gmax: S.gmax && !gaveGmax,
      };
      const slot = await fill(c, band, notes, may);
      if (slot._gotMega) { gaveMega = true; notes.push(c.row.n + " is the one that Mega "
        + "Evolves — Mega Showdown allows one per battle."); }
      if (slot._gotGmax) gaveGmax = true;
      delete slot._gotMega; delete slot._gotGmax;
      slots.push(slot);
    }
    if (picked.length < want) {
      notes.push("Only " + picked.length + " of " + want
                 + " could be found — the filters left too small a pool.");
    }
    return { team: slots, why: notes, roleCount, band, want };
  }

  /** Give a picked species a form, a level, a nature, an ability, four moves and an item. */
  async function fill(c, band, notes, may) {
    may = may || {};
    const full = await TB().species(c.row.id);
    const slot = TB().slotFor(c.row);
    if (!full) return slot;

    const forms = full.forms || [];
    // ---- form: a Mega or Gigantamax only for the ONE pick allowed to have it ----
    let fi = 0;
    if (may.mega) {
      const m = forms.findIndex(f => f.mega);
      if (m > 0) { fi = m; slot._gotMega = true; }
    }
    if (!fi && may.gmax) {
      const g = forms.findIndex(f => (f.aspects || []).some(a => /gmax|gigantamax/i.test(a)));
      if (g > 0) { fi = g; slot._gotGmax = true; }
    }
    // never leave a battle-only form selected that no gimmick allows
    if (fi > 0 && forms[fi].battleOnly && !slot._gotMega && !slot._gotGmax) fi = 0;
    slot.form = fi;
    const form = forms[fi] || {};

    slot.level = band.lvl;
    // Cobblemon writes a genderless species as maleRatio -1; everything else can be MALE
    slot.gender = (full.maleRatio === -1) ? "GENDERLESS"
                : (full.maleRatio === 0) ? "FEMALE" : "MALE";

    // ---- ability: the hidden one is usually the interesting one ---------------
    const abil = (form.abilities && form.abilities.length ? form.abilities
                  : (full.abilities || []));
    slot.ability = ((abil.find(a => a.hidden) || abil[0]) || {}).id || "";

    // ---- nature and EVs ------------------------------------------------------
    // The nature must never drop the stat the Pokemon actually attacks with. Picking it
    // from the role alone handed Mega Darkrai an Impish (+Def −SpA) with two special
    // attacks, which is worse than leaving it neutral. Which side it hits from is the
    // same question `pickMoves` asks, so it is asked once, here.
    const st = form.stats || c.row.s;
    const role = roleOf(st);
    const phys = (st.attack || 0) >= (st.special_attack || 0);
    const defensive = role === "wall" || role === "pivot";
    const fast = (st.speed || 0) >= 90;
    slot.nature = defensive ? (phys ? "impish" : "calm")
      : phys ? (fast ? "jolly" : "adamant")
      : (fast ? "timid" : "modest");

    const OFF = phys ? "attack" : "special_attack";
    slot.evs = role === "wall" ? { hp: 252, defence: 128, special_defence: 128 }
      : role === "pivot" ? Object.assign({ hp: 252, defence: 4 }, { [OFF]: 252 })
      : Object.assign({ hp: 4, speed: 252 }, { [OFF]: 252 });
    D().STATS.forEach(([k]) => { slot.ivs[k] = 31; });

    // ---- moves: STAB first, then the best coverage it can actually learn ------
    slot.moveset = pickMoves(full, form, role, c.row);

    // ---- held item ----------------------------------------------------------
    slot.heldItem = await pickItem(full, form, role, slot, !!slot._gotMega);
    return slot;
  }

  function pickMoves(full, form, role, row) {
    const legal = TB().legalMoves(full, form);
    const st = form.stats || row.s || {};
    const mine = (form.types || row.t || []).map(t => String(t).toLowerCase());
    // Which side it actually hits from — its own stats decide, not its role. A wall with
    // 130 Attack and 60 Sp. Atk still wants physical moves; picking by role alone gave
    // Ting-Lu a Dark Pulse off 59 Sp. Atk.
    const phys = (st.attack || 0) >= (st.special_attack || 0);
    const want = phys ? "Physical" : "Special";
    // A defensive Pokemon with no offensive investment gets two attacks and two things to
    // do with the turns it survives; an attacker gets three and one.
    const defensive = role === "wall" || role === "pivot";
    const nAttack = defensive ? 2 : 3;

    const rows = [];
    legal.forEach((how, id) => {
      const mi = (D().DB.moves || {})[id];
      if (mi) rows.push(Object.assign({ id: id }, mi));
    });
    if (!rows.length) return [];

    /* Power alone puts Giga Impact on everything, so the drawbacks count. These multipliers
     * come from what the move costs you, not from a tier list: a recharge turn is a free
     * switch for the opponent, a charge turn telegraphs, and Explosion ends the Pokemon.
     * `data/moves.json` carries the flags straight out of Showdown's own table. */
    const SITUATIONAL = new RegExp("^(lastresort|dreameater|synchronoise|naturalgift"
      + "|fling|beatup|present|snore|falseswipe|endeavor|counter|mirrorcoat|metalburst"
      + "|steelroller|stuffcheeks|belch|spitup|swallow|return|frustration)$");
    // locks you in for 2-3 turns and then confuses you — one is a choice, two is a mess
    const LOCKING = new RegExp("^(outrage|thrash|petaldance|ragingfury)$");
    // Rest is deliberately NOT in here. It is the move every defensive Pokemon can learn,
    // so it won every recovery slot and three of six team members woke up with the same
    // move; and without Sleep Talk or a Chesto Berry it hands the opponent two free turns.
    // It stays available as a last resort further down.
    const RECOVER = new RegExp("^(recover|roost|softboiled|synthesis|moonlight|morningsun"
      + "|slackoff|milkdrink|shoreup|strengthsap|wish)$");
    // Setup has a side too. Diancie came out Jolly with Calm Mind — a special boost on a
    // physical set, which does nothing. Split by what the Pokemon actually attacks with;
    // the neutral ones (Dragon Dance, Shell Smash, Agility) suit either.
    const SETUP_ANY = new RegExp("^(dragondance|shellsmash|agility|workup|irondefense"
      + "|coil|bellydrum)$");
    const SETUP_PHYS = new RegExp("^(swordsdance|bulkup|howl|honeclaws|meditate)$");
    const SETUP_SPEC = new RegExp("^(nastyplot|calmmind|quiverdance|tailglow"
      + "|geomancy|chargebeam)$");
    const SETUP = phys ? new RegExp(SETUP_ANY.source.slice(0, -2) + "|"
                                    + SETUP_PHYS.source.slice(2))
                       : new RegExp(SETUP_ANY.source.slice(0, -2) + "|"
                                    + SETUP_SPEC.source.slice(2));
    const UTILITY = new RegExp("^(toxic|willowisp|thunderwave|substitute|protect"
      + "|lightscreen|reflect|stealthrock|spikes|taunt|knockoff|uturn|voltswitch"
      + "|leechseed|haze|defog|rapidspin)$");

    const taken = new Set();
    let locked = 0;
    const rank = m => {
      const acc = (m.accuracy === true ? 100 : (m.accuracy || 100));
      let v = (m.power || 0) * (acc / 100);
      if (m.multi > 1) v *= 2.6;                                     // Bullet Seed hits 2-5
      if (m.recharge) v *= 0.45;                                     // Hyper Beam, Giga Impact
      if (m.charge) v *= 0.5;                                        // Solar Beam
      if (m.boom) v *= 0.05;                                         // Explosion
      if (m.recoil) v *= 0.85;
      if (m.zmax) v = 0;                                             // not a real moveslot
      if (SITUATIONAL.test(m.id)) v *= 0.3;
      if (LOCKING.test(m.id) && locked) v *= 0.25;
      if (m.category !== want) v *= 0.55;                            // off its better side
      if (mine.includes(String(m.type).toLowerCase())) v *= 1.5;     // STAB
      if (taken.has(String(m.type).toLowerCase())) v *= 0.3;         // no four Fire moves
      return v;
    };

    const best = [];
    const dmg = rows.filter(m => m.power > 0 && !m.zmax);
    for (let n = 0; n < nAttack && dmg.length; n++) {
      dmg.sort((a, b) => rank(b) - rank(a));
      const m = dmg.shift();
      if (!m || rank(m) <= 0) break;
      best.push(m.id);
      taken.add(String(m.type).toLowerCase());
      if (LOCKING.test(m.id)) locked++;
    }

    // ---- the non-damaging slots ---------------------------------------------
    // A defensive Pokemon wants to stay alive first; an attacker wants to get bigger.
    const status = rows.filter(m => !m.power && !best.includes(m.id) && !m.zmax);
    const order = defensive ? [RECOVER, UTILITY, SETUP] : [SETUP, RECOVER, UTILITY];
    for (const rx of order) {
      if (best.length >= 4) break;
      const hit = status.find(m => rx.test(m.id) && !best.includes(m.id));
      if (hit) best.push(hit.id);
    }
    while (best.length < 4 && status.length) {
      const m = status.shift();
      if (!best.includes(m.id)) best.push(m.id);
    }
    while (best.length < 4 && dmg.length) best.push(dmg.shift().id);
    return best.slice(0, 4);
  }

  async function pickItem(full, form, role, slot, isTheMega) {
    const all = await TB().items();
    const want = id => all.find(x => x.id === id || x.bare === id);
    // Only the one Pokemon that actually Mega Evolves gets a stone. On anybody else the
    // stone is a dead slot — it does nothing but occupy the held item.
    if (isTheMega && form.mega) {
      if (form.stone && form.stone.id) {
        const key = String(form.stone.id).replace(/[^a-z0-9]/gi, "").toLowerCase();
        const row = all.find(x => x.bare.replace(/[^a-z0-9]/gi, "").toLowerCase() === key);
        if (row) return row.id;
      }
      // A Primal has no stone — Groudon and Kyogre are triggered by the Red and Blue Orb,
      // Dialga by the Adamant Orb. Showdown's table marks those with `itemUser`, so the
      // item that names this species IS the trigger. (Rayquaza legitimately needs nothing:
      // it Mega Evolves by knowing Dragon Ascent.)
      const key = String(full.id).replace(/[^a-z0-9]/gi, "").toLowerCase();
      const orb = all.find(x => (x.user || []).some(u =>
        u.toLowerCase().replace(/[^a-z0-9]/g, "") === key));
      if (orb) return orb.id;
    }
    const by = role === "wall" ? ["leftovers", "rocky_helmet", "eviolite"]
      : role === "pivot" ? ["leftovers", "sitrus_berry", "assault_vest"]
      : ["life_orb", "choice_band", "focus_sash", "expert_belt"];
    for (const id of by) {
      const r = want(id);
      if (r && (!r.user || r.user.length === 0)) return r.id;
    }
    return "";
  }

  /* ---------------------------------------------------------------- panel */
  function panel(apply) {
    const el = (t, c, x) => D().el(t, c, x);
    const box = el("section", "tb-suggest");
    const head = el("div", "tb-metahead");
    head.appendChild(el("h2", null, "Suggest a team"));
    head.appendChild(el("i", "tb-note",
      "Scored from base stats, types and each species' own learnset — no tier list, so a "
      + "pack's fakemon is judged the same way Garchomp is."));
    box.appendChild(head);

    const row = el("div", "tb-mrow");

    const themes = [["", "Any type"]].concat(
      D().TYPE_ORDER.map(t => [t, D().cap(t)]));
    row.appendChild(fld("Theme", sel(themes, S.theme, v => { S.theme = v; })));
    // The preset only fills the boxes — after that the level and the size RANGE are the
    // setting, and the size is rolled inside that range on every press.
    const lvIn = num(1, 100, S.level, v => { S.level = v; retarget(); });
    const loIn = num(1, 6, S.sizeMin, v => {
      S.sizeMin = v;
      if (S.sizeMax < v) { S.sizeMax = v; hiIn.value = v; }   // keep min <= max
      retarget();
    });
    const hiIn = num(1, 6, S.sizeMax, v => {
      S.sizeMax = v;
      if (S.sizeMin > v) { S.sizeMin = v; loIn.value = v; }
      retarget();
    });
    const preset = sel([["", "Preset…"]].concat(BANDS.map(b =>
      [b.id, b.label + " — lv " + b.lvl + ", "
       + (b.min === b.max ? b.min : b.min + "-" + b.max) + " mons"])), "", v => {
      const b = BANDS.find(x => x.id === v);
      if (!b) return;
      S.level = b.lvl;
      S.sizeMin = b.min;
      S.sizeMax = b.max;
      lvIn.value = b.lvl;
      loIn.value = b.min;
      hiIn.value = b.max;
      retarget();
    });
    row.appendChild(fld("Preset", preset));
    row.appendChild(fld("Trainer level", lvIn));
    const sz = el("div", "tb-range");
    sz.appendChild(loIn);
    sz.appendChild(el("span", "tb-dash", "to"));
    sz.appendChild(hiIn);
    row.appendChild(fld("Team size", sz));
    row.appendChild(fld("Pool", sel([["all", "Everything"], ["official", "Official 1025 only"],
      ["custom", "Addon species only"]], S.packs, v => { S.packs = v; })));
    box.appendChild(row);

    const toggles = el("div", "tb-toggles");
    toggles.appendChild(chk("Balance roles", S.roles, v => { S.roles = v; }));
    toggles.appendChild(chk("Allow Megas", S.mega, v => { S.mega = v; }));
    toggles.appendChild(chk("Allow Gigantamax", S.gmax, v => { S.gmax = v; }));
    const tera = chk("Terastallisation", false, () => {});
    tera.classList.add("off");
    tera.title = "RCT's trainer files have no field for a Tera type, so it cannot be exported.";
    tera.querySelector("input").disabled = true;
    tera.appendChild(el("i", "tb-hint", "not in RCT's format"));
    toggles.appendChild(tera);
    box.appendChild(toggles);

    const go = el("button", "btn", "Suggest a team");
    const status = el("span", "tb-status");
    const bar = el("div", "tb-gorow");
    bar.appendChild(go); bar.appendChild(status);
    box.appendChild(bar);

    // What that level actually buys, said out loud — the two gates are not obvious from a
    // number box, and the count moves a lot between levels.
    const gauge = el("p", "tb-note");
    box.insertBefore(gauge, bar);
    function retarget() {
      const lv = Math.max(1, Math.min(100, +S.level || 1));
      const n = D().DB.index.filter(r => r.s && r.b && (r.l || 1) <= lv).length;
      const lo = Math.max(1, Math.min(6, +S.sizeMin || 1));
      const hi = Math.max(lo, Math.min(6, +S.sizeMax || lo));
      gauge.textContent = "At level " + lv + ": aiming for about " + bstFor(lv)
        + " base stat total, and " + n.toLocaleString() + " species have evolved far enough "
        + "to exist by then. Team size is rolled "
        + (lo === hi ? "at " + lo : "between " + lo + " and " + hi) + " each time.";
    }
    retarget();

    go.addEventListener("click", async () => {
      go.disabled = true;
      status.textContent = "thinking…";
      try {
        const res = await suggest((n, tot, who) => {
          status.textContent = "building " + who + " (" + n + " of " + tot + ")";
        });
        status.textContent = "";
        if (res.why && res.why.length) status.textContent = res.why.join(" ");
        apply(res.team);
      } catch (e) {
        status.textContent = "could not build a team: " + e.message;
        go.disabled = false;
      }
    });
    return box;

    function fld(label, node) {
      const w = el("label", "tb-field");
      w.appendChild(el("span", null, label));
      w.appendChild(node);
      return w;
    }
    function num(lo, hi, cur, on) {
      const i = el("input", "tb-num");
      i.type = "number"; i.min = lo; i.max = hi; i.value = cur;
      i.addEventListener("change", () => {
        const v = Math.max(lo, Math.min(hi, +i.value || lo));
        i.value = v; on(v);
      });
      return i;
    }
    function sel(values, cur, on) {
      const s = el("select");
      values.forEach(([v, l]) => {
        const o = el("option", null, l);
        o.value = v;
        if (v === cur) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener("change", () => on(s.value));
      return s;
    }
    function chk(label, cur, on) {
      const w = el("label", "chk");
      const i = el("input");
      i.type = "checkbox"; i.checked = !!cur;
      i.addEventListener("change", () => on(i.checked));
      w.appendChild(i);
      w.appendChild(document.createTextNode(" " + label));
      return w;
    }
  }

  window.TeamSuggest = { panel, suggest, roleOf, coverage, effect, BANDS };
})();
