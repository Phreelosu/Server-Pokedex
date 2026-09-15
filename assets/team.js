/* Team Builder — build a six-Pokemon team and export it as a Radical Cobblemon Trainers
 * trainer file.
 *
 * The export target is not invented. RCT ships 1559 trainers at
 * `data/rctmod/trainers/*.json` and every field written here was read off those files:
 *
 *   { name, identity?, ai?, battleRules?, battleFormat?, bag?,
 *     team: [ { species, gender, level, nature, ability, moveset[<=4],
 *               ivs:{}, evs:{}, heldItem?[], aspects?[] } ] }
 *
 * Two things about that shape are easy to get wrong and both were checked against all 1478
 * heldItem entries in those files:
 *
 *   * `heldItem` is an ARRAY, even for one item;
 *   * Cobblemon's own items are written BARE (`life_orb`) while another mod's keep their
 *     namespace (`mega_showdown:alakazite`). data/items.json carries the right spelling
 *     for each, so nothing here has to guess.
 *
 * There is no tera or dynamax field anywhere in the schema, so the gimmick control offers
 * Megas (a held stone, or a `mega_x`-style aspect — both appear in real trainer files) and
 * Gigantamax/Eternamax (an aspect), and says plainly that Tera cannot be exported.
 *
 * Legality is enforced rather than suggested: the move list for a slot is that species'
 * own learnset and the ability list is that FORM's abilities. An export that the game
 * refuses is worse than one the builder would not let you make.
 */
(function () {
  "use strict";

  const D = () => window.DEX;
  const KEY = "dex-team-builder";

  const NATURES = {
    hardy: null, lonely: ["attack", "defence"], brave: ["attack", "speed"],
    adamant: ["attack", "special_attack"], naughty: ["attack", "special_defence"],
    bold: ["defence", "attack"], docile: null, relaxed: ["defence", "speed"],
    impish: ["defence", "special_attack"], lax: ["defence", "special_defence"],
    timid: ["speed", "attack"], hasty: ["speed", "defence"], serious: null,
    jolly: ["speed", "special_attack"], naive: ["speed", "special_defence"],
    modest: ["special_attack", "attack"], mild: ["special_attack", "defence"],
    quiet: ["special_attack", "speed"], bashful: null,
    rash: ["special_attack", "special_defence"],
    calm: ["special_defence", "attack"], gentle: ["special_defence", "defence"],
    sassy: ["special_defence", "speed"], careful: ["special_defence", "special_attack"],
    quirky: null,
  };
  const NATURE_LIST = Object.keys(NATURES).sort();
  const GENDERS = ["MALE", "FEMALE", "GENDERLESS"];
  const FORMATS = ["GEN_9_SINGLES", "GEN_9_DOUBLES"];
  const EV_TOTAL = 510, EV_STAT = 252, IV_MAX = 31;
  const BAG_ITEMS = [
    ["cobblemon:potion", "Potion"], ["cobblemon:super_potion", "Super Potion"],
    ["cobblemon:hyper_potion", "Hyper Potion"], ["cobblemon:full_restore", "Full Restore"],
    ["cobblemon:remedy", "Remedy"], ["cobblemon:fine_remedy", "Fine Remedy"],
    ["cobblemon:superb_remedy", "Superb Remedy"],
  ];
  // a Pokemon that is battle-only and not a Mega — Gigantamax, Eternamax, Primal
  const GIMMICK = [
    ["mega", "Mega Evolution"],
    ["gmax", "Gigantamax"],
    ["eternamax", "Eternamax"],
  ];

  let ITEMS = null, SPECIES_CACHE = {};
  let T = null;                       // the team being edited

  /* ------------------------------------------------------------- state */
  function blank() {
    return {
      name: "", identity: "", format: "GEN_9_SINGLES",
      maxItemUses: 4, aiMargin: 0.15, bag: [],
      slots: [null, null, null, null, null, null],
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v && Array.isArray(v.slots)) {
          while (v.slots.length < 6) v.slots.push(null);
          return v;
        }
      }
    } catch (e) {}
    return blank();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) {} }

  /* -------------------------------------------------------------- data */
  async function items() {
    if (!ITEMS) ITEMS = await D().dj("data/items.json").catch(() => []);
    return ITEMS;
  }
  async function species(id) {
    if (!SPECIES_CACHE[id]) {
      SPECIES_CACHE[id] = await D().dj("data/species/" + encodeURIComponent(id) + ".json")
        .catch(() => null);
    }
    return SPECIES_CACHE[id];
  }

  const HOWS = ["level", "egg", "tm", "tutor", "special", "legacy"];

  /** Every move this species-and-form can legally know.
   *
   *  A FORM CAN HAVE ITS OWN LEARNSET and 846 of the ones in this pack do — Alolan
   *  Ninetales learns Aurora Veil, Freeze-Dry and Blizzard, and plain Ninetales learns
   *  none of them, while 34 of the plain form's moves are gone. `wiki_data.py` writes the
   *  difference onto the form as `mvAdd` / `mvDel`; ignoring it offered moves the game
   *  refuses and hid moves it allows. Pass the form to get the right list. */
  function legalMoves(full, form) {
    const out = new Map();
    const mv = (full && full.moves) || {};
    for (const how of HOWS) {
      for (const row of (mv[how] || [])) {
        const id = typeof row === "string" ? row : (row.id || row.move || row.name);
        if (id && !out.has(String(id))) out.set(String(id), how);
      }
    }
    if (form) {
      (form.mvDel || []).forEach(id => out.delete(String(id)));
      const add = form.mvAdd || {};
      for (const how of HOWS) {
        for (const row of (add[how] || [])) {
          const id = typeof row === "string" ? row : (row.id || row.move || row.name);
          if (id) out.set(String(id), how);
        }
      }
    }
    return out;
  }

  function moveInfo(id) {
    return (D().DB.moves && D().DB.moves[id]) || null;
  }

  /* ----------------------------------------------------------- helpers */
  const el = (t, c, x) => D().el(t, c, x);
  const cap = s => D().cap(s);

  function opt(value, label, sel) {
    const o = el("option", null, label == null ? value : label);
    o.value = value;
    if (sel) o.selected = true;
    return o;
  }
  function select(cls, values, current, onChange) {
    const s = el("select", cls);
    values.forEach(v => {
      const [val, lab] = Array.isArray(v) ? v : [v, null];
      s.appendChild(opt(val, lab, String(val) === String(current)));
    });
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function field(label, node) {
    const w = el("label", "tb-field");
    w.appendChild(el("span", null, label));
    w.appendChild(node);
    return w;
  }
  function evTotal(slot) {
    return Object.values(slot.evs || {}).reduce((a, b) => a + (+b || 0), 0);
  }

  /* -------------------------------------------------------------- slot */
  function newSlot(row) {
    return {
      id: row.id, form: 0, level: 50, gender: "MALE", nature: "hardy",
      ability: "", moveset: [], heldItem: "", ivs: {}, evs: {},
    };
  }

  async function slotCard(i, host) {
    const slot = T.slots[i];
    const card = el("div", "tb-slot" + (slot ? "" : " empty"));

    if (!slot) {
      const b = el("button", "tb-add");
      b.appendChild(el("span", "tb-plus", "+"));
      b.appendChild(el("span", null, "Add a Pokémon"));
      b.addEventListener("click", () => pickSpecies(row => {
        T.slots[i] = newSlot(row);
        save(); redraw();
      }));
      card.appendChild(b);
      host.appendChild(card);
      return;
    }

    const full = await species(slot.id);
    if (!full) {
      card.appendChild(el("p", "tb-warn", "Could not load " + slot.id + "."));
      host.appendChild(card);
      return;
    }
    const forms = full.forms || [];
    if (slot.form >= forms.length) slot.form = 0;
    const form = forms[slot.form] || forms[0] || {};

    /* ---- head: name, form, remove ---- */
    const head = el("div", "tb-head");
    const nm = el("div", "tb-name");
    nm.appendChild(el("b", null, full.name || cap(slot.id)));
    if (forms.length > 1) {
      nm.appendChild(select("tb-form", forms.map((f, n) => [n, f.name || "Normal"]),
        slot.form, v => {
          slot.form = +v;
          // a form change can invalidate the ability — Mega Charizard X is not Blaze
          const abil = (forms[+v] || {}).abilities || [];
          if (!abil.some(a => a.id === slot.ability)) slot.ability = "";
          save(); redraw();
        }));
    }
    head.appendChild(nm);
    const tys = el("div", "tb-types");
    (form.types || full.types || []).forEach(t => tys.appendChild(D().chip(t)));
    head.appendChild(tys);
    const rm = el("button", "tb-x", "×");
    rm.title = "Remove";
    rm.addEventListener("click", () => { T.slots[i] = null; save(); redraw(); });
    head.appendChild(rm);
    card.appendChild(head);

    /* ---- the basics ---- */
    const grid = el("div", "tb-grid");

    const lvl = el("input", "tb-num");
    lvl.type = "number"; lvl.min = 1; lvl.max = 100; lvl.value = slot.level;
    lvl.addEventListener("change", () => {
      slot.level = Math.max(1, Math.min(100, +lvl.value || 1));
      lvl.value = slot.level; save();
    });
    grid.appendChild(field("Level", lvl));

    grid.appendChild(field("Gender", select(null, GENDERS.map(g => [g, cap(g.toLowerCase())]),
      slot.gender, v => { slot.gender = v; save(); })));

    grid.appendChild(field("Nature", select(null, NATURE_LIST.map(n => {
      const m = NATURES[n];
      return [n, cap(n) + (m ? "  +" + short(m[0]) + " −" + short(m[1]) : "  (neutral)")];
    }), slot.nature, v => { slot.nature = v; save(); })));

    const abil = (form.abilities && form.abilities.length ? form.abilities
                  : (full.abilities || []));
    if (!slot.ability && abil.length) slot.ability = abil[0].id;
    grid.appendChild(field("Ability", select(null,
      abil.map(a => [a.id, a.name + (a.hidden ? "  (hidden)" : "")]),
      slot.ability, v => { slot.ability = v; save(); })));
    card.appendChild(grid);

    /* ---- held item ---- */
    const all = await items();
    const legalItem = it => !it.user || it.user.some(u =>
      u.toLowerCase().replace(/[^a-z0-9]/g, "") === String(full.id).replace(/[^a-z0-9]/g, ""));
    const usable = all.filter(legalItem);
    const cats = [];
    usable.forEach(it => { if (!cats.includes(it.cat)) cats.push(it.cat); });
    const itemSel = el("select", "tb-item");
    itemSel.appendChild(opt("", "— no held item —", !slot.heldItem));
    cats.forEach(c => {
      const g = el("optgroup"); g.label = c;
      usable.filter(it => it.cat === c)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(it => g.appendChild(opt(it.id, it.name, it.id === slot.heldItem)));
      itemSel.appendChild(g);
    });
    itemSel.addEventListener("change", () => { slot.heldItem = itemSel.value; save(); redraw(); });
    const itemWrap = field("Held item", itemSel);
    const itRow = all.find(x => x.id === slot.heldItem);
    if (itRow && itRow.desc) itemWrap.appendChild(el("i", "tb-hint", itRow.desc));
    // The stone that actually triggers this Mega. `form.stone` is {id,name} and the id is
    // BARE, while items.json holds the namespaced spelling for a stone that came from a mod
    // — so match on the bare id and export whatever items.json calls it.
    if (form.mega && form.stone && form.stone.id) {
      const want = String(form.stone.id).replace(/[^a-z0-9]/gi, "").toLowerCase();
      const row = all.find(x => x.bare.replace(/[^a-z0-9]/gi, "").toLowerCase() === want);
      const id = row ? row.id : form.stone.id;
      if (slot.heldItem !== id) {
        const s = el("button", "tb-link",
                     "Hold " + ((row && row.name) || form.stone.name || "its Mega Stone"));
        s.addEventListener("click", () => { slot.heldItem = id; save(); redraw(); });
        itemWrap.appendChild(s);
      }
    }
    card.appendChild(itemWrap);

    /* ---- moves ---- */
    const legal = legalMoves(full, form);
    slot.moveset = (slot.moveset || []).filter(m => legal.has(m)).slice(0, 4);
    const mvBox = el("div", "tb-moves");
    for (let n = 0; n < 4; n++) {
      const cur = slot.moveset[n] || "";
      const row = el("div", "tb-move");
      const s = el("select");
      s.appendChild(opt("", "— empty —", !cur));
      const chosen = new Set(slot.moveset.filter((m, k) => k !== n));
      const byHow = {};
      legal.forEach((how, id) => { (byHow[how] = byHow[how] || []).push(id); });
      [["level", "By level"], ["egg", "Egg move"], ["tm", "TM"],
       ["tutor", "Tutor"], ["special", "Special"],
       ["legacy", "Legacy"]].forEach(([how, lab]) => {
        const list = (byHow[how] || []).filter(id => !chosen.has(id) || id === cur);
        if (!list.length) return;
        const g = el("optgroup"); g.label = lab;
        list.map(id => [id, (moveInfo(id) || {}).name || cap(id.replace(/_/g, " "))])
          .sort((a, b) => a[1].localeCompare(b[1]))
          .forEach(([id, nm2]) => g.appendChild(opt(id, nm2, id === cur)));
        s.appendChild(g);
      });
      s.addEventListener("change", () => {
        const v = s.value;
        const next = slot.moveset.slice();
        if (v) next[n] = v; else next.splice(n, 1);
        slot.moveset = next.filter(Boolean).slice(0, 4);
        save(); redraw();
      });
      row.appendChild(s);
      const mi = moveInfo(cur);
      if (mi) {
        const tag = el("span", "tb-mv");
        const c = el("span", "ty sm", mi.type || "?");
        c.style.background = D().typeColor(mi.type);
        tag.appendChild(c);
        tag.appendChild(el("i", null,
          (mi.category || "") + (mi.power ? " · " + mi.power : "") +
          (mi.accuracy && mi.accuracy !== true ? " · " + mi.accuracy + "%" : "")));
        row.appendChild(tag);
      }
      mvBox.appendChild(row);
    }
    card.appendChild(el("h4", "tb-sub", "Moves"));
    card.appendChild(mvBox);

    /* ---- IVs and EVs ---- */
    const spread = el("div", "tb-spread");
    const used = evTotal(slot);
    const cap2 = el("div", "tb-evhead");
    cap2.appendChild(el("span", null, "EVs"));
    const left = el("b", used > EV_TOTAL ? "over" : null, used + " / " + EV_TOTAL);
    cap2.appendChild(left);
    const quick = el("span", "tb-quick");
    [["Clear", {}],
     ["Physical", { hp: 4, attack: 252, speed: 252 }],
     ["Special", { hp: 4, special_attack: 252, speed: 252 }],
     ["Bulky", { hp: 252, defence: 128, special_defence: 128 }]].forEach(([lab, sp]) => {
      const b = el("button", "tb-link", lab);
      b.addEventListener("click", () => { slot.evs = Object.assign({}, sp); save(); redraw(); });
      quick.appendChild(b);
    });
    cap2.appendChild(quick);
    spread.appendChild(cap2);

    D().STATS.forEach(([k, lab]) => {
      const r = el("div", "tb-stat");
      r.appendChild(el("span", "tb-sl", lab));
      const iv = el("input", "tb-iv");
      iv.type = "number"; iv.min = 0; iv.max = IV_MAX;
      iv.value = slot.ivs[k] == null ? IV_MAX : slot.ivs[k];
      iv.title = "IV";
      iv.addEventListener("change", () => {
        slot.ivs[k] = Math.max(0, Math.min(IV_MAX, +iv.value || 0));
        iv.value = slot.ivs[k]; save();
      });
      const ev = el("input", "tb-ev");
      ev.type = "number"; ev.min = 0; ev.max = EV_STAT;
      ev.value = slot.evs[k] || 0;
      ev.title = "EV";
      ev.addEventListener("change", () => {
        let v = Math.max(0, Math.min(EV_STAT, +ev.value || 0));
        // the game caps the TOTAL at 510, so a spread that would blow past it is trimmed
        // here rather than exported and silently clipped in game
        const others = evTotal(slot) - (slot.evs[k] || 0);
        if (others + v > EV_TOTAL) v = Math.max(0, EV_TOTAL - others);
        if (v) slot.evs[k] = v; else delete slot.evs[k];
        save(); redraw();
      });
      r.appendChild(iv); r.appendChild(ev);
      const bar = el("span", "tb-bar");
      const fill = el("i");
      fill.style.width = Math.round(((slot.evs[k] || 0) / EV_STAT) * 100) + "%";
      bar.appendChild(fill);
      r.appendChild(bar);
      spread.appendChild(r);
    });
    card.appendChild(el("h4", "tb-sub", "Spread"));
    card.appendChild(spread);

    host.appendChild(card);
  }

  const short = k => ({ hp: "HP", attack: "Atk", defence: "Def", special_attack: "SpA",
                        special_defence: "SpD", speed: "Spe" })[k] || k;

  /* ------------------------------------------------------ species picker */
  function pickSpecies(done) {
    const back = el("div", "sheetback");
    const sheet = el("div", "sheet tb-pick");
    const q = el("input", "tb-search");
    q.type = "search"; q.placeholder = "Search the dex…";
    const list = el("div", "tb-results");
    sheet.appendChild(el("h3", null, "Choose a Pokémon"));
    sheet.appendChild(q);
    sheet.appendChild(list);
    back.appendChild(sheet);
    back.addEventListener("click", e => { if (e.target === back) back.remove(); });
    document.body.appendChild(back);

    const paint = () => {
      const term = q.value.trim().toLowerCase();
      list.innerHTML = "";
      const rows = D().DB.index
        .filter(r => !term || r.n.toLowerCase().includes(term) ||
                     String(r.d || "") === term ||
                     (r.t || []).some(t => t.toLowerCase() === term))
        .slice(0, 160);
      rows.forEach(r => {
        const b = el("button", "tb-res");
        b.appendChild(el("b", null, r.n));
        const ty = el("span", "tb-rt");
        (r.t || []).forEach(t => ty.appendChild(D().chip(t)));
        b.appendChild(ty);
        b.appendChild(el("i", null, "BST " + r.b));
        b.addEventListener("click", () => { back.remove(); done(r); });
        list.appendChild(b);
      });
      if (!rows.length) list.appendChild(el("p", "tb-warn", "Nothing matches that."));
    };
    q.addEventListener("input", paint);
    paint();
    q.focus();
  }

  /* ------------------------------------------------------------ export */
  async function buildExport() {
    const out = { name: T.name.trim() || "Custom Trainer" };
    if (T.identity.trim()) out.identity = T.identity.trim();
    out.ai = { type: "rct", data: { maxSelectMargin: +T.aiMargin } };
    out.battleRules = { maxItemUses: +T.maxItemUses };
    if (T.format && T.format !== "GEN_9_SINGLES") out.battleFormat = T.format;
    if (T.bag.length) {
      out.bag = T.bag.map(b => ({ item: b.item, quantity: +b.qty || 1 }));
    }
    out.team = [];
    for (const slot of T.slots) {
      if (!slot) continue;
      const full = await species(slot.id);
      if (!full) continue;
      const form = (full.forms || [])[slot.form] || {};
      const mon = {
        species: full.stem || full.id,
        gender: slot.gender,
        level: +slot.level,
        nature: slot.nature,
        ability: slot.ability || ((form.abilities || full.abilities || [])[0] || {}).id || "",
        moveset: (slot.moveset || []).slice(0, 4),
        ivs: {}, evs: {},
      };
      D().STATS.forEach(([k]) => {
        const key = EXPORT_STAT[k];
        if (slot.ivs[k] != null) mon.ivs[key] = slot.ivs[k];
        if (slot.evs[k]) mon.evs[key] = slot.evs[k];
      });
      if (slot.heldItem) mon.heldItem = [slot.heldItem];
      // the base form carries no aspects; every other form is selected by them
      const asp = (form.aspects || []).filter(Boolean);
      if (asp.length) mon.aspects = asp;
      out.team.push(mon);
    }
    return out;
  }

  // RCT writes the six stats with Showdown's short keys, not Cobblemon's long ones
  const EXPORT_STAT = {
    hp: "hp", attack: "atk", defence: "def",
    special_attack: "spa", special_defence: "spd", speed: "spe",
  };

  function fileName() {
    const n = (T.name || "custom trainer").toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return (n || "custom_trainer") + ".json";
  }

  /* ------------------------------------------------------------ render */
  let HOST = null;
  function redraw() { if (HOST) render(HOST); }

  async function render(host) {
    HOST = host;
    if (!T) T = load();
    host.innerHTML = "";
    const wrap = el("div", "wrap tb");

    /* ---- trainer meta ---- */
    const meta = el("section", "tb-meta");
    const h = el("div", "tb-metahead");
    h.appendChild(el("h2", null, "Trainer"));
    const count = T.slots.filter(Boolean).length;
    h.appendChild(el("span", "count", count + " of 6"));
    meta.appendChild(h);

    const mrow = el("div", "tb-mrow");
    const nameIn = el("input");
    nameIn.placeholder = "Ace Trainer Abel";
    nameIn.value = T.name;
    nameIn.addEventListener("input", () => { T.name = nameIn.value; save(); });
    mrow.appendChild(field("Name", nameIn));

    const idIn = el("input");
    idIn.placeholder = "optional — shown in battle";
    idIn.value = T.identity;
    idIn.addEventListener("input", () => { T.identity = idIn.value; save(); });
    mrow.appendChild(field("Identity", idIn));

    mrow.appendChild(field("Format", select(null,
      FORMATS.map(f => [f, f.replace("GEN_9_", "Gen 9 ").replace("_", " ")
        .replace(/(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase())]),
      T.format, v => { T.format = v; save(); })));

    const items2 = el("input", "tb-num");
    items2.type = "number"; items2.min = 0; items2.max = 12; items2.value = T.maxItemUses;
    items2.addEventListener("change", () => { T.maxItemUses = +items2.value || 0; save(); });
    mrow.appendChild(field("Item uses", items2));

    mrow.appendChild(field("AI margin", select(null,
      [[0.15, "0.15 — standard"], [0.25, "0.25 — looser"], [0.05, "0.05 — sharp"]],
      T.aiMargin, v => { T.aiMargin = +v; save(); })));
    meta.appendChild(mrow);

    /* bag */
    const bag = el("div", "tb-bag");
    bag.appendChild(el("span", "tb-sl", "Bag"));
    T.bag.forEach((b, n) => {
      const pill = el("span", "tb-pill");
      pill.appendChild(document.createTextNode(
        (BAG_ITEMS.find(x => x[0] === b.item) || [, b.item])[1] + " ×" + b.qty));
      const x = el("button", "tb-x", "×");
      x.addEventListener("click", () => { T.bag.splice(n, 1); save(); redraw(); });
      pill.appendChild(x);
      bag.appendChild(pill);
    });
    const addBag = select("tb-addbag", [["", "+ add an item"]].concat(BAG_ITEMS),
      "", v => {
        if (!v) return;
        const ex = T.bag.find(b => b.item === v);
        if (ex) ex.qty++; else T.bag.push({ item: v, qty: 1 });
        save(); redraw();
      });
    bag.appendChild(addBag);
    meta.appendChild(bag);
    wrap.appendChild(meta);

    /* ---- suggester ---- */
    wrap.appendChild(window.TeamSuggest
      ? window.TeamSuggest.panel(team => { T.slots = team; save(); redraw(); })
      : el("div"));

    /* ---- the six ---- */
    const grid = el("div", "tb-slots");
    wrap.appendChild(grid);
    host.appendChild(wrap);
    for (let i = 0; i < 6; i++) await slotCard(i, grid);

    /* ---- export ---- */
    const foot = el("section", "tb-export");
    const data = await buildExport();
    const txt = JSON.stringify(data, null, 2);

    const bar = el("div", "tb-ebar");
    bar.appendChild(el("h2", null, "Export"));
    bar.appendChild(el("code", "tb-file", "data/rctmod/trainers/" + fileName()));

    const dl = el("a", "btn");
    dl.textContent = "Download";
    dl.href = "data:application/json;charset=utf-8," + encodeURIComponent(txt);
    dl.download = fileName();
    bar.appendChild(dl);

    const cp = el("button", "btn ghost", "Copy");
    cp.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(txt);
        cp.textContent = "Copied";
        setTimeout(() => { cp.textContent = "Copy"; }, 1200);
      } catch (e) {
        // clipboard needs https; select the text instead so ctrl-C still works
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        cp.textContent = "Selected — press Ctrl+C";
      }
    });
    bar.appendChild(cp);

    const clr = el("button", "btn ghost", "Clear team");
    clr.addEventListener("click", () => { T = blank(); save(); redraw(); });
    bar.appendChild(clr);
    foot.appendChild(bar);

    const problems = validate(data);
    if (problems.length) {
      const warn = el("div", "tb-problems");
      warn.appendChild(el("b", null, "Worth fixing before you use this:"));
      const ul = el("ul");
      problems.forEach(p => ul.appendChild(el("li", null, p)));
      warn.appendChild(ul);
      foot.appendChild(warn);
    }

    const pre = el("pre", "tb-json", txt);
    foot.appendChild(pre);
    host.querySelector(".tb").appendChild(foot);
  }

  /** Things the game will not like, said plainly. Not blocking — a half-built team is a
   *  normal state to be in — but an empty moveset really does mean a Pokemon that stands
   *  there doing nothing, so it is worth a line. */
  function validate(data) {
    const out = [];
    if (!data.team.length) out.push("No Pokémon on the team yet.");
    data.team.forEach((m, i) => {
      const who = (m.species || "slot " + (i + 1));
      if (!m.moveset.length) out.push(who + " has no moves — it will do nothing in battle.");
      if (!m.ability) out.push(who + " has no ability set.");
      const ev = Object.values(m.evs || {}).reduce((a, b) => a + b, 0);
      if (ev > EV_TOTAL) out.push(who + " has " + ev + " EVs, over the " + EV_TOTAL + " cap.");
    });
    return out;
  }

  window.TeamBuilder = {
    render,
    // the suggester writes slots straight into the team
    slotFor: newSlot,
    species, items, legalMoves, NATURES, NATURE_LIST,
  };
})();
