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
    { id: "early", label: "Early route", lvl: 18, min: 1, max: 3, rank: "route" },
    { id: "mid", label: "Mid game", lvl: 35, min: 3, max: 4, rank: "route" },
    { id: "gym", label: "Gym leader", lvl: 50, min: 6, max: 6, rank: "boss" },
    { id: "late", label: "Late game", lvl: 65, min: 4, max: 6, rank: "route" },
    { id: "elite", label: "Elite Four", lvl: 78, min: 6, max: 6, rank: "boss" },
    { id: "champion", label: "Champion", lvl: 88, min: 6, max: 6, rank: "boss" },
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

  /* How strong a trainer's Pokemon are BUILT, as against which Pokemon they have.
   *
   * Measured, not guessed: RCT's own 1559 trainers, 5093 Pokemon, grouped by level and by
   * whether the trainer is a boss (leader, Elite Four, champion, rival, admin, Ace Trainer)
   * or a route trainer (claude/58). A missing `ivs`/`evs` in an RCT file is 0 — rctapi's
   * StatsModel defaults every field to 0 — so the averages count those as 0.
   *
   *   level ->  EV total | mean IV | share holding an item | share of moves that are
   *                                                           plain level-up moves
   * A level-18 route trainer in RCT has ~0 EVs, IVs around 4, no item and the moves it
   * learnt most recently; a level-90 champion has 505 EVs, 31s, an item on everything and
   * a hand-picked set. The suggester used to build EVERY team like the champion.
   */
  const PROFILE = {
    route: [[1, 10, 4, .03, .80], [25, 25, 4, .03, .80], [35, 40, 6, .08, .76],
            [45, 70, 9, .16, .75], [55, 90, 11, .20, .74], [65, 190, 15, .36, .71],
            [75, 375, 25, .73, .59], [100, 455, 30, .97, .35]],
    boss: [[1, 30, 20, .22, .62], [25, 135, 22, .22, .61], [35, 160, 20, .25, .66],
           [45, 170, 21, .28, .66], [55, 215, 21, .42, .66], [65, 300, 23, .62, .62],
           [75, 330, 31, .66, .43], [100, 505, 31, .97, .35]],
  };
  function profileFor(level, rank) {
    const t = PROFILE[rank] || PROFILE.boss, L = Math.max(1, Math.min(100, level || 1));
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1], b = t[i];
      if (L <= b[0]) {
        const f = (L - a[0]) / (b[0] - a[0]);
        const v = a.map((x, k) => x + (b[k] - x) * f);
        return { ev: v[1], iv: v[2], item: v[3], levelup: v[4] };
      }
    }
    const z = t[t.length - 1];
    return { ev: z[1], iv: z[2], item: z[3], levelup: z[4] };
  }
  const NATURE_LIST = ["hardy", "lonely", "brave", "adamant", "naughty", "bold", "docile",
    "relaxed", "impish", "lax", "timid", "hasty", "serious", "jolly", "naive", "modest",
    "mild", "quiet", "bashful", "rash", "calm", "gentle", "sassy", "careful", "quirky"];

  const ROLES = ["physical", "special", "wall", "pivot"];

  const S = {
    theme: "", packs: "all", roles: true, mega: false, gmax: false, z: false, forms: true,
    style: "fair", rank: "boss",
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
    // Each species is a candidate once per way it can battle: its own form, and every
    // alternate form with different types or stats (`af`, wiki_data.py) — Alolan Ninetales
    // for an ice team, Heat Rotom, Lost Lore's variants. Only regional/alternate forms a
    // Pokemon simply IS; Megas, Gigantamax and battle-only forms stay behind the gimmick
    // toggles. The first version scored the species' own form only, so no alternate form
    // was ever suggested (claude/56).
    let cands = [];
    pool.forEach(r => {
      cands.push({ row: r, fi: 0, t: r.t || [], b: r.b, s: r.s });
      if (S.forms) (r.af || []).forEach(a => {
        if (a.s && a.b) cands.push({ row: r, fi: a.i, t: a.t || [], b: a.b, s: a.s });
      });
    });
    if (theme) cands = cands.filter(c => c.t.some(t => String(t).toLowerCase() === theme));
    if (!cands.length) return { team: [], why: ["Nothing in the dex matches those filters."] };

    // ---- score, then take the best six that also balance ---------------------
    const scored = cands.map(c => {
      const r = c.row;
      const gap = Math.abs(c.b - band.bst);
      let sc = 1000 - gap * 1.6;
      if (theme && c.t[0] && String(c.t[0]).toLowerCase() === theme) sc += 40;
      // Having a Mega is NOT a reason to pick a species, in either direction. It used to be
      // +35 with the gimmick on, which stacked all six slots with mega-capable species when
      // only one can ever use it, and -10 with it off, which penalised a perfectly good
      // Pokemon for a form the team was not going to use. The gimmick decides what a pick
      // may DO, never who gets picked.
      sc += Math.random() * 60;                 // two runs should not be identical
      return { row: r, fi: c.fi, t: c.t, score: sc, role: roleOf(c.s) };
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
      const after = coverage(have.concat(c.t.map(t => String(t).toLowerCase())));
      if (picked.length >= 2 && after === before && Math.random() < 0.6) continue;
      picked.push(c);
      used.add(c.row.id);
      roleCount[c.role] = (roleCount[c.role] || 0) + 1;
      c.t.forEach(t => have.push(String(t).toLowerCase()));
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
    // The first pick that CAN Mega Evolve from the form it was picked in does — "first
    // that has one" rather than a fixed index, so an Alolan pick whose species' only Megas
    // are of the plain form does not use up the one chance.

    // ---- turn each pick into a filled slot ------------------------------------
    const slots = [];
    const notes = [];
    const ctx = { usedItems: new Set(), level: level };
    let gaveMega = false, gaveGmax = false;
    for (let i = 0; i < 6; i++) {
      const c = picked[i];
      if (!c) { slots.push(null); continue; }
      if (onProgress) onProgress(i + 1, picked.length, c.row.n);
      const may = {
        mega: S.mega && !gaveMega && c.row.m > 0,
        gmax: S.gmax && !gaveGmax,
      };
      const slot = await fill(c, band, notes, may, ctx);
      if (slot._gotMega) { gaveMega = true; notes.push(c.row.n + " is the one that Mega "
        + "Evolves — Mega Showdown allows one per battle."); }
      if (slot._gotGmax) gaveGmax = true;
      delete slot._gotMega; delete slot._gotGmax;
      slots.push(slot);
    }

    // ---- one Z-Move per battle -------------------------------------------------
    // Like the Mega, a Z-Move is once per battle, so ONE team member holds a Z-Crystal.
    // An exclusive crystal (Decidium Z, Gholdenium Z…) wins when its species is on the
    // team and can learn the move it upgrades — that move is taught if the set lacks it.
    // Otherwise the type crystal for the strongest STAB attack on any non-Mega slot.
    if (S.z) {
      const z = await giveZ(slots, notes);
      if (z) notes.push(z);
    }
    slots.forEach(s => { if (s) { delete s._full; delete s._form; delete s._fixedItem; } });

    if (picked.length < want) {
      notes.push("Only " + picked.length + " of " + want
                 + " could be found — the filters left too small a pool.");
    }
    return { team: slots, why: notes, roleCount, band, want };
  }

  /** Give a picked species a form, a level, a nature, an ability, four moves and an item. */
  const GMAX = /gmax|gigantamax|dynamax/i;
  const MEGA_ASPECT = /^mega([_-].*)?$|^primal$/i;
  /** Forms a trainer's Pokemon can simply be in: not a Mega, not Gigantamax, not a form
   *  that only exists mid-battle (Zen Mode, Blade Forme), not a Terastal or Totem look. */
  function startForm(f) {
    return f && !f.mega && !f.battleOnly
      && !(f.aspects || []).some(a => GMAX.test(a))
      && !/terastal|totem/i.test(f.name || "");
  }
  const sameBattle = (a, b) => JSON.stringify(a.types) === JSON.stringify(b.types)
    && JSON.stringify(a.stats) === JSON.stringify(b.stats);

  /** Give a picked species a form, a level, a nature, an ability, four moves and an item. */
  async function fill(c, band, notes, may, ctx) {
    may = may || {};
    ctx = ctx || { usedItems: new Set(), level: band.lvl };
    const full = await TB().species(c.row.id);
    const slot = TB().slotFor(c.row);
    if (!full) return slot;

    const forms = full.forms || [];
    // ---- form ------------------------------------------------------------------
    // The candidate says which form it was scored as. A form that battles exactly like it
    // (Vivillon's patterns, Pikachu's caps, a gender look) is an equally good pick, so one
    // of those is chosen at random half the time — a trainer is not always the plain one.
    let base = (c.fi > 0 && startForm(forms[c.fi])) ? c.fi : 0;
    if (S.forms && forms[base]) {
      const twins = forms.map((f, i) => i).filter(i => i !== base && startForm(forms[i])
        && sameBattle(forms[i], forms[base]));
      if (twins.length && Math.random() < 0.5) base = twins[Math.floor(Math.random() * twins.length)];
    }
    let fi = base;
    // ---- a Mega or Gigantamax only for the ONE pick allowed to have it ----------
    // The Mega has to be OF the form that was picked: Alolan Raichu becomes Mega-Alolan,
    // not Mega-X. A Mega's own aspects, minus the mega ones, must all be on the base form.
    const baseAsp = new Set((forms[base] || {}).aspects || []);
    const fits = f => (f.aspects || []).filter(a => !MEGA_ASPECT.test(a)).every(a => baseAsp.has(a));
    if (may.mega) {
      const ms = forms.map((f, i) => i).filter(i => forms[i].mega && fits(forms[i]));
      if (ms.length) { fi = ms[Math.floor(Math.random() * ms.length)]; slot._gotMega = true; }
    }
    if (!slot._gotMega && may.gmax) {
      const g = forms.findIndex(f => (f.aspects || []).some(a => GMAX.test(a)) && fits(
        { aspects: (f.aspects || []).filter(a => !GMAX.test(a)) }));
      if (g > 0) { fi = g; slot._gotGmax = true; }
    }
    // never leave a battle-only form selected that no gimmick allows
    if (fi > 0 && forms[fi].battleOnly && !slot._gotMega && !slot._gotGmax) fi = 0;
    slot.form = fi;
    const form = forms[fi] || {};

    slot.level = band.lvl;
    // Cobblemon writes a genderless species as maleRatio -1; everything else can be MALE
    // A gender FORM decides it (Female Ballearia is maleRatio 0); otherwise the species,
    // and a species that can be either comes out either.
    const mr = (form.maleRatio != null) ? form.maleRatio : full.maleRatio;
    slot.gender = (mr === -1) ? "GENDERLESS" : (mr === 0) ? "FEMALE"
                : (mr === 1) ? "MALE" : (Math.random() < (mr == null ? 0.5 : mr) ? "MALE" : "FEMALE");

    const fair = S.style !== "tough";
    const prof = profileFor(band.lvl, S.rank);
    const boss = S.rank === "boss";

    // ---- ability: the hidden one is usually the interesting one ---------------
    // ...for a boss. A route trainer's Pokemon has whichever ordinary ability it rolled.
    const abil = (form.abilities && form.abilities.length ? form.abilities
                  : (full.abilities || []));
    const plain = abil.filter(a => !a.hidden);
    slot.ability = ((fair && !boss && plain.length)
      ? plain[Math.floor(Math.random() * plain.length)]
      : (abil.find(a => a.hidden) || abil[0]) || {}).id || "";

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
    // A route trainer below the late game has whatever nature it was caught with.
    if (fair && !boss && band.lvl < 65) {
      slot.nature = NATURE_LIST[Math.floor(Math.random() * NATURE_LIST.length)];
    }

    const OFF = phys ? "attack" : "special_attack";
    const full252 = role === "wall" ? { hp: 252, defence: 128, special_defence: 128 }
      : role === "pivot" ? Object.assign({ hp: 252, defence: 4 }, { [OFF]: 252 })
      : Object.assign({ hp: 4, speed: 252 }, { [OFF]: 252 });
    if (!fair) {
      slot.evs = full252;
      D().STATS.forEach(([k]) => { slot.ivs[k] = 31; });
    } else {
      // The same spread, scaled to the EV total a trainer of this level and rank has in
      // RCT (±30 %), and IVs around its mean. Below ~10 EVs a stat is left at 0.
      const tot = Math.min(510, Math.round(prof.ev * (0.7 + Math.random() * 0.6)));
      const f = tot / 510;
      slot.evs = {};
      Object.entries(full252).forEach(([k, v]) => {
        const x = Math.min(252, Math.round(v * f / 4) * 4);
        if (x >= 8) slot.evs[k] = x;
      });
      D().STATS.forEach(([k]) => {
        slot.ivs[k] = prof.iv >= 30 ? 31
          : Math.max(0, Math.min(31, Math.round(prof.iv + (Math.random() * 12 - 6))));
      });
    }

    // ---- moves: STAB first, then the best coverage it can actually learn ------
    // Fair: only moves it could know at this level, and most of the set is what it
    // learnt most recently — the rest is picked, and more of it is picked as the level
    // and the trainer's rank go up (RCT: 80 % plain level-up moves at lv 20, 35 % at 90).
    slot.moveset = pickMoves(full, form, role, c.row,
      fair ? { level: band.lvl, levelup: prof.levelup } : null);

    // ---- held item ----------------------------------------------------------
    // A Mega stone, a Z-crystal and an item a form is made of are always held; anything
    // else only as often as RCT's trainers of this level hold something.
    slot.heldItem = await pickItem(full, form, role, slot, !!slot._gotMega, ctx);
    if (fair && slot.heldItem && !slot._fixedItem && !slot._gotMega
        && Math.random() > prof.item) slot.heldItem = "";
    if (slot.heldItem) ctx.usedItems.add(slot.heldItem);
    slot._full = full; slot._form = form;
    return slot;
  }

  /** Level-up moves this form learns at or below `L`, in the order they are learnt. */
  function levelUpAt(full, form, L) {
    const del = new Set((form && form.mvDel) || []);
    const rows = ((full.moves || {}).level || []).filter(r => !del.has(r.id))
      .concat(((form && form.mvAdd) || {}).level || []);
    return rows.filter(r => (r.level || 1) <= L)
      .sort((a, b) => (a.level || 1) - (b.level || 1)).map(r => r.id);
  }

  function pickMoves(full, form, role, row, fair) {
    let legal = TB().legalMoves(full, form);
    let recent = [];
    if (fair) {
      // A level-up move it has not reached yet is not a move it knows. TM, tutor and egg
      // moves stay — a trainer can teach those — but only in the picked slots.
      const upTo = new Set(levelUpAt(full, form, fair.level));
      const lvOnly = new Map();
      ((full.moves || {}).level || []).forEach(r => lvOnly.set(r.id, r.level || 1));
      const other = new Set();
      ["egg", "tm", "tutor"].forEach(h => ((full.moves || {})[h] || []).concat(
        ((form && form.mvAdd) || {})[h] || []).forEach(r => other.add(r.id)));
      const keep = new Map();
      legal.forEach((how, id) => { if (upTo.has(id) || other.has(id)) keep.set(id, how); });
      legal = keep;
      // the last four moves learnt, most recent first, skipping ones that do nothing
      const MV = D().DB.moves || {};
      recent = levelUpAt(full, form, fair.level).reverse()
        .filter((id, i, a) => a.indexOf(id) === i && MV[id] && !MV[id].zmax);
    }
    const picked = pickBest(legal, form, role, row);
    if (!fair) return picked;
    // Keep `levelup` share of the set as the most recently learnt moves; fill the rest
    // with picked ones. A route trainer at level 18 ends up with (nearly) its last four
    // level-up moves, like a trainer in the games; a champion with a chosen set.
    const nKeep = Math.min(recent.length, Math.round(4 * fair.levelup + (Math.random() - 0.5)));
    const out = recent.slice(0, nKeep);
    for (const id of picked) { if (out.length >= 4) break; if (!out.includes(id)) out.push(id); }
    for (const id of recent) { if (out.length >= 4) break; if (!out.includes(id)) out.push(id); }
    return out.slice(0, 4);
  }

  function pickBest(legal, form, role, row) {
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

  const NORM = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const LOW = x => String(x || "").toLowerCase();
  const PLATE = { fire: "flame_plate", water: "splash_plate", electric: "zap_plate",
    grass: "meadow_plate", ice: "icicle_plate", fighting: "fist_plate", poison: "toxic_plate",
    ground: "earth_plate", flying: "sky_plate", psychic: "mind_plate", bug: "insect_plate",
    rock: "stone_plate", ghost: "spooky_plate", dragon: "draco_plate", dark: "dread_plate",
    steel: "iron_plate", fairy: "pixie_plate" };
  const BOOST = { normal: "silk_scarf", fire: "charcoal_stick", water: "mystic_water",
    electric: "magnet", grass: "miracle_seed", ice: "never_melt_ice", fighting: "black_belt",
    poison: "poison_barb", ground: "soft_sand", flying: "sharp_beak", psychic: "twisted_spoon",
    bug: "silver_powder", rock: "hard_stone", ghost: "spell_tag", dragon: "dragon_fang",
    dark: "black_glasses", steel: "metal_coat", fairy: "fairy_feather" };
  const RESIST = { fire: "occa_berry", water: "passho_berry", electric: "wacan_berry",
    grass: "rindo_berry", ice: "yache_berry", fighting: "chople_berry", poison: "kebia_berry",
    ground: "shuca_berry", flying: "coba_berry", psychic: "payapa_berry", bug: "tanga_berry",
    rock: "charti_berry", ghost: "kasib_berry", dragon: "haban_berry", dark: "colbur_berry",
    steel: "babiri_berry", fairy: "roseli_berry" };
  // Orbs that trigger Primal Reversion are the Mega's business, not an everyday item.
  const GIMMICK_ITEM = /^(red_orb|blue_orb)$/;
  const SETUP_ID = /^(swordsdance|dragondance|nastyplot|calmmind|quiverdance|bulkup|shellsmash|coil|agility|workup|tailglow|geomancy|honeclaws|victorydance|tidyup)$/;

  /** Does a Showdown `itemUser` name mean this Pokemon? "Pikachu" means any Pikachu;
   *  "Raichu-Alola" or "Silvally-Fire" means that form (its name or an aspect starts
   *  with the part after the species). `exact` asks for the form-specific kind only. */
  function userIs(u, full, form, exact) {
    const sp = NORM(full.name || full.id), n = NORM(u);
    if (!sp || !n.startsWith(sp)) return false;
    const rest = n.slice(sp.length);
    if (!rest) return !exact;
    return [form.name].concat(form.aspects || []).map(NORM)
      .some(x => x && (x.startsWith(rest) || rest.startsWith(x)));
  }

  /** The item a FORM is made of: Arceus' plates, Silvally's memories, Genesect's drives,
   *  Ogerpon's masks, Origin Giratina's core. Mega Showdown sets these forms from the
   *  held item, so without it the Pokemon battles as its plain form. */
  function formItem(all, full, form) {
    const asp = form.aspects || [];
    const ok = x => x && x.ex !== false;
    if (asp.some(a => /-plate$/.test(a))) {
      const t = LOW((form.types || [])[0]);
      const r = all.find(x => x.bare === PLATE[t]);
      if (ok(r)) return r;
    }
    return all.find(x => ok(x) && !GIMMICK_ITEM.test(x.bare)
      && (x.user || []).some(u => userIs(u, full, form, true))) || null;
  }

  async function pickItem(full, form, role, slot, isTheMega, ctx) {
    const all = await TB().items();
    ctx = ctx || { usedItems: new Set(), level: slot.level || 50 };
    // Only the one Pokemon that actually Mega Evolves gets a stone. On anybody else the
    // stone is a dead slot — it does nothing but occupy the held item.
    if (isTheMega && form.mega) {
      if (form.stone && form.stone.id) {
        const key = String(form.stone.id).replace(/[^a-z0-9]/gi, "").toLowerCase();
        const row = all.find(x => x.cat === "Mega Stone"
          && x.bare.replace(/[^a-z0-9]/gi, "").toLowerCase() === key);
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
    const fixed = formItem(all, full, form);
    if (fixed) { slot._fixedItem = true; return fixed.id; }

    /* Everything else is a weighted draw from what THIS set would actually use — the
     * first version walked a fixed list per role, so every wall and every pivot got
     * Leftovers and every attacker Life Orb (claude/56). The weights come from the
     * Pokemon's own stats, types, moves and evolution line; the draw keeps two runs
     * from being identical; a team does not hold the same item twice when it can help it. */
    const st = form.stats || {};
    const types = (form.types || []).map(LOW);
    const moves = (slot.moveset || []).map(id => Object.assign({ id: id },
      (D().DB.moves || {})[id] || {}));
    const hits = moves.filter(m => m.power > 0);
    const phys = (st.attack || 0) >= (st.special_attack || 0);
    const defensive = role === "wall" || role === "pivot";
    const bulk = (st.hp || 0) + (st.defence || 0) + (st.special_defence || 0);
    const off = Math.max(st.attack || 0, st.special_attack || 0);
    const spe = st.speed || 0;
    const lvl = ctx.level || slot.level || 50;
    const weak = t => effect(t, types);
    const has = rx => moves.some(m => rx.test(m.id));
    const stab = hits.filter(m => types.includes(LOW(m.type)))
      .sort((a, b) => (b.power || 0) - (a.power || 0))[0];
    const nfe = (full.evolutions || []).some(e => e && e.to);

    const W = new Map();
    const add = (id, w) => { if (w > 0) W.set(id, (W.get(id) || 0) + w); };

    // species' own items: Light Ball, Soul Dew, Thick Club…
    all.forEach(x => {
      if (!GIMMICK_ITEM.test(x.bare) && x.cat === "Species Item"
          && (x.user || []).some(u => userIs(u, full, form, false))) add(x.id, 12);
    });
    if (nfe) add("eviolite", defensive ? 10 : 5);
    if (defensive) {
      add(types.includes("poison") ? "black_sludge" : "leftovers", 4);
      add("rocky_helmet", (st.defence || 0) >= (st.special_defence || 0) ? 3.5 : 1);
      add("sitrus_berry", 2.5);
      if (hits.length >= 3) add("assault_vest", 4);
      if (has(/^(reflect|lightscreen|auroraveil)$/)) add("light_clay", 7);
      if (has(/^rest$/)) add("chesto_berry", 9);
      if (has(/^(toxic|willowisp|leechseed)$/)) add("leftovers", 1.5);
    } else {
      if (hits.length >= 4) {
        if (spe >= 65 && spe <= 105) add("choice_scarf", 4);
        add(phys ? "choice_band" : "choice_specs", 4);
        if (bulk >= off * 1.5) add("assault_vest", 2.5);
      }
      add("life_orb", moves.some(m => m.recoil) ? 1 : 3);
      if (moves.some(m => m.multi > 1)) add("loaded_dice", 7);
      if (moves.some(m => m.charge)) add("power_herb", 6);
      if (has(/^shellsmash$/)) add("white_herb", 8);
      if (has(SETUP_ID)) { add("weakness_policy", 1.5); add("lum_berry", 2.5); }
      if (spe >= 90 && bulk < off * 1.7) add("focus_sash", 3);
      add(phys ? "muscle_band" : "wise_glasses", 1.2);
      if (new Set(hits.map(m => LOW(m.type))).size >= 3) add("expert_belt", 2);
      if (stab && BOOST[LOW(stab.type)]) add(BOOST[LOW(stab.type)], 2.5);
      add("scope_lens", 0.6);
    }
    if (weak("rock") >= 4) add("heavy_duty_boots", 6);
    DEFENDERS.forEach(t => { if (weak(t) >= 4 && RESIST[t]) add(RESIST[t], 3); });
    if (weak("ground") >= 2 && !types.includes("flying")) add("air_balloon", 1);
    add("lum_berry", 0.8);
    // An early-route trainer holds what an early-route player finds: berries and a
    // type-boosting item, not a Choice Band.
    if (lvl < 30) {
      add("oran_berry", 4); add("sitrus_berry", 2);
      if (stab && BOOST[LOW(stab.type)]) add(BOOST[LOW(stab.type)], 3);
      ["choice_band", "choice_specs", "choice_scarf", "assault_vest", "weakness_policy",
       "loaded_dice", "heavy_duty_boots"].forEach(id => W.delete(id));
    }

    const row = id => all.find(x => (x.id === id || x.bare === id) && x.ex !== false
      && x.cat !== "Mega Stone" && x.cat !== "Z-Crystal");
    const draw = avoid => {
      const opts = [];
      W.forEach((w, id) => {
        const r = row(id);
        if (r && !(avoid && ctx.usedItems.has(r.id))) opts.push([r.id, w * (0.6 + Math.random())]);
      });
      if (!opts.length) return "";
      let tot = opts.reduce((n, o) => n + o[1], 0), roll = Math.random() * tot;
      for (const [id, w] of opts) { roll -= w; if (roll <= 0) return id; }
      return opts[opts.length - 1][0];
    };
    return draw(true) || draw(false) || "";
  }

  /** One Z-Crystal for the team (see `suggest`). Returns the note, or "". */
  async function giveZ(slots, notes) {
    const all = await TB().items();
    const zs = all.filter(x => x.cat === "Z-Crystal" && x.ex !== false);
    const MV = D().DB.moves || {};
    let best = null;
    slots.forEach((s, i) => {
      if (!s || !s._full || s._fixedItem) return;
      const full = s._full, form = s._form || {};
      if (form.mega || (form.aspects || []).some(a => GMAX.test(a))) return;
      const types = (form.types || []).map(LOW);
      // an exclusive crystal, when its move is learnable
      const legal = TB().legalMoves(full, form);
      zs.forEach(z => {
        if (!z.zFrom || !(z.user || []).some(u => userIs(u, full, form, false))) return;
        if (!legal.has(z.zFrom)) return;
        const sc = 1000 + Math.random() * 50;
        if (!best || sc > best.sc) best = { sc, i, z, teach: z.zFrom };
      });
      // a type crystal for a move it already has
      (s.moveset || []).forEach(id => {
        const m = MV[id];
        if (!m || !(m.power > 0) || m.zmax) return;
        const t = LOW(m.type);
        const z = zs.find(x => x.zType === t && !(x.user || []).length);
        if (!z) return;
        let sc = (m.power || 0) * (types.includes(t) ? 1.5 : 1);
        if (m.recharge || m.charge) sc *= 1.3;       // a Z-Move ignores the drawback
        sc += Math.random() * 40;
        if (!best || sc > best.sc) best = { sc, i, z };
      });
    });
    if (!best) return "";
    const s = slots[best.i];
    s.heldItem = best.z.id;
    if (best.teach && !s.moveset.includes(best.teach)) {
      const types = ((s._form || {}).types || []).map(LOW);
      // replace the weakest move that is not its own-type attack
      let k = -1, low = Infinity;
      s.moveset.forEach((id, j) => {
        const m = MV[id] || {};
        const v = (m.power || 0) * (types.includes(LOW(m.type)) ? 1.5 : 1);
        if (v < low) { low = v; k = j; }
      });
      if (s.moveset.length < 4) s.moveset.push(best.teach);
      else if (k >= 0) s.moveset[k] = best.teach;
    }
    const who = (s._full && s._full.name) || s.id;
    const zm = best.z.zMove ? " (" + best.z.zMove + ")" : "";
    return who + " holds " + best.z.name + zm + " — one Z-Move per battle, like the Mega.";
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
      S.rank = b.rank;
      rankSel.value = b.rank;
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
    // How the Pokemon are BUILT. "Fair" follows what RCT's own trainers of that level and
    // rank carry (EVs, IVs, items, moves it knows by that level); "Competitive" is every
    // Pokemon at 31 IVs, 252/252 EVs, an item and a hand-picked set (claude/58).
    const rankSel = sel([["route", "Route trainer"], ["boss", "Boss — leader, Elite Four, rival"]],
      S.rank, v => { S.rank = v; retarget(); });
    row.appendChild(fld("Trainer", rankSel));
    row.appendChild(fld("Build", sel([["fair", "Fair — like RCT's own trainers"],
      ["tough", "Competitive — max EVs/IVs, best moves"]], S.style, v => { S.style = v; retarget(); })));
    box.appendChild(row);

    const toggles = el("div", "tb-toggles");
    toggles.appendChild(chk("Balance roles", S.roles, v => { S.roles = v; }));
    toggles.appendChild(chk("Allow Megas", S.mega, v => { S.mega = v; }));
    toggles.appendChild(chk("Allow Gigantamax", S.gmax, v => { S.gmax = v; }));
    toggles.appendChild(chk("Allow Z-Moves", S.z, v => { S.z = v; }));
    toggles.appendChild(chk("Alternate forms", S.forms, v => { S.forms = v; }));
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
        + (lo === hi ? "at " + lo : "between " + lo + " and " + hi) + " each time."
        + (S.style === "tough" ? " Built competitively: 31 IVs, full EVs, an item each."
           : (() => { const p = profileFor(lv, S.rank);
               return " Built like RCT's " + (S.rank === "boss" ? "bosses" : "route trainers")
                 + " at that level: about " + Math.round(p.ev) + " EVs, IVs around "
                 + Math.round(p.iv) + ", " + Math.round(p.item * 100) + "% hold an item, and "
                 + Math.round(p.levelup * 4) + " of 4 moves are its latest level-up moves."; })());
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

  window.TeamSuggest = { panel, suggest, roleOf, coverage, effect, BANDS, settings: S };
})();
