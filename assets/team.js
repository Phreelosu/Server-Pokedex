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
      fileId: "", rewards: { items: [], cd: 0 }, rematch: { on: false, days: 1 },
      slots: [null, null, null, null, null, null],
    };
  }
  /** older saved teams predate the id and rewards fields */
  function upgrade(v) {
    if (typeof v.fileId !== "string") v.fileId = "";
    if (!v.rewards || !Array.isArray(v.rewards.items)) v.rewards = { items: [], cd: 0 };
    if (!v.rematch || typeof v.rematch.on !== "boolean") v.rematch = { on: false, days: 1 };
    return v;
  }
  function load() {
    const lt = libOpenTeam();
    if (lt) return lt;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v && Array.isArray(v.slots)) {
          while (v.slots.length < 6) v.slots.push(null);
          return upgrade(v);
        }
      }
    } catch (e) {}
    return blank();
  }
  function save() {
    if (libCurrent()) { libStore(LIB.cur, T, true); return; }
    try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) {}
  }

  /* ---------------------------------------------------- trainer files (claude/85)
   * Many RCT trainer files at once: import them, edit one at a time (prev / next), download them
   * all back as one zip with the same file names. Each file is its own localStorage entry, so
   * nothing is lost on reload; the scratch team above keeps its own slot. */
  const LKEY = "dex-tb-lib", FKEY = id => "dex-tb-file:" + id;
  let LIB = null;
  function libLoad() {
    if (LIB) return LIB;
    try { LIB = JSON.parse(localStorage.getItem(LKEY) || "null"); } catch (e) { LIB = null; }
    if (!LIB || !Array.isArray(LIB.ids)) LIB = { ids: [], cur: "", dirty: {} };
    LIB.dirty = LIB.dirty || {};
    return LIB;
  }
  function libPersist() { try { localStorage.setItem(LKEY, JSON.stringify(LIB)); } catch (e) {} }
  function libCurrent() { libLoad(); return LIB.cur && LIB.ids.includes(LIB.cur) ? LIB.cur : ""; }
  function libGet(id) {
    try { const v = JSON.parse(localStorage.getItem(FKEY(id)) || "null"); if (v && Array.isArray(v.slots)) return upgrade(v); } catch (e) {}
    return null;
  }
  function libStore(id, team, dirty) {
    try { localStorage.setItem(FKEY(id), JSON.stringify(team)); } catch (e) { alert("The browser's storage is full — download what you have."); }
    if (dirty) { LIB.dirty[id] = 1; libPersist(); }
  }
  function libOpenTeam() {
    const id = libCurrent();
    if (!id) return null;
    const t = libGet(id);
    if (t) { while (t.slots.length < 6) t.slots.push(null); t.fileId = id; }
    return t;
  }
  function libOpen(id) {
    libLoad(); LIB.cur = id || ""; libPersist();
    T = id ? (libOpenTeam() || blank()) : loadScratch();
    redraw();
  }
  function loadScratch() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.slots)) return upgrade(v); } catch (e) {}
    return blank();
  }

  /** an RCT trainer file (the builder's own export, or one written by hand) -> builder state */
  const IMPORT_STAT = { hp: "hp", atk: "attack", def: "defence", spa: "special_attack", spd: "special_defence", spe: "speed" };
  async function fromExport(j, id) {
    const t = blank();
    t.fileId = id;
    t.name = String(j.name || "");
    t.identity = String(j.identity || "");
    if (j.battleFormat) t.format = j.battleFormat;
    if (j.battleRules && j.battleRules.maxItemUses != null) t.maxItemUses = +j.battleRules.maxItemUses;
    if (j.ai && j.ai.data && j.ai.data.maxSelectMargin != null) t.aiMargin = +j.ai.data.maxSelectMargin;
    t.bag = (j.bag || []).map(b => ({ item: b.item, qty: +b.quantity || 1 }));
    if (j.rewards) t.rewards = { items: (j.rewards.items || []).map(r => ({ item: r.item, count: +r.count || 1, name: r.name })),
                                 cd: +j.rewards.cobbledollars || 0 };
    if (+j.rematchDays > 0) t.rematch = { on: true, days: +j.rematchDays };
    const ids = {};
    (D().DB.index || []).forEach(r => { ids[squash(r.id)] = r.id; });
    const notes = [];
    for (const [n, m] of (j.team || []).slice(0, 6).entries()) {
      const sid = ids[squash(m.species)];
      if (!sid) { notes.push(`${m.species}: not in the dex`); continue; }
      const full = await species(sid);
      const want = (m.aspects || []).map(a => String(a).toLowerCase()).sort().join(",");
      let form = 0;
      if (full && want) {
        const fs = full.forms || [];
        let k = fs.findIndex(f => (f.aspects || []).map(a => String(a).toLowerCase()).sort().join(",") === want);
        if (k < 0) k = fs.findIndex(f => want.split(",").every(a => (f.aspects || []).map(x => String(x).toLowerCase()).includes(a)));
        form = Math.max(0, k);
      }
      const slot = newSlot({ id: sid });
      slot.form = form;
      slot.level = +m.level || 50;
      if (m.gender) slot.gender = m.gender;
      if (m.nature) slot.nature = String(m.nature).toLowerCase();
      slot.ability = m.ability || "";
      slot.moveset = (m.moveset || []).slice(0, 4);
      Object.entries(m.ivs || {}).forEach(([k, v]) => { if (IMPORT_STAT[k]) slot.ivs[IMPORT_STAT[k]] = +v; });
      Object.entries(m.evs || {}).forEach(([k, v]) => { if (IMPORT_STAT[k]) slot.evs[IMPORT_STAT[k]] = +v; });
      const held = Array.isArray(m.heldItem) ? m.heldItem[0] : m.heldItem;
      if (held) slot.heldItem = String(held);
      t.slots[n] = slot;
    }
    return { team: t, notes };
  }

  async function libImport(files) {
    libLoad();
    const done = [], bad = [];
    for (const f of files) {
      if (!/\.json$/i.test(f.name)) continue;
      const id = slug(f.name.replace(/\.json$/i, ""));
      try {
        const txt = (await f.text()).replace(/,(\s*[}\]])/g, "$1");     // a stray trailing comma is common in hand edits
        const { team } = await fromExport(JSON.parse(txt), id);
        libStore(id, team, false);
        delete LIB.dirty[id];
        if (!LIB.ids.includes(id)) LIB.ids.push(id);
        done.push(id);
      } catch (e) { bad.push(f.name); }
    }
    LIB.ids.sort();
    libPersist();
    if (done.length) libOpen(LIB.cur && done.includes(LIB.cur) ? LIB.cur : done.sort()[0]);
    if (bad.length) alert("Could not read: " + bad.join(", "));
  }

  // a stored (uncompressed) zip, as the zone planner writes it
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = cen.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: "application/zip" });
  }

  async function libDownloadAll(btn) {
    libLoad();
    if (libCurrent()) libStore(LIB.cur, T, false);
    const files = [];
    for (const id of LIB.ids) {
      const t = libGet(id);
      if (!t) continue;
      t.fileId = id;
      files.push({ name: id + ".json", text: JSON.stringify(await buildExport(t), null, 2) });
      if (btn) btn.textContent = `Packing ${files.length}/${LIB.ids.length}…`;
    }
    EXPORT_NOTES.splice(0);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip(files));
    a.download = "RCT_Trainers.zip";
    document.body.appendChild(a); a.click(); a.remove();
    if (btn) btn.textContent = "Download all (.zip)";
  }

  function libraryPanel() {
    libLoad();
    const sec = el("section", "tb-lib");
    const head = el("div", "tb-metahead");
    head.appendChild(el("h2", null, "Trainer files"));
    const nd = LIB.ids.filter(i => LIB.dirty[i]).length;
    head.appendChild(el("span", "count", LIB.ids.length ? `${LIB.ids.length} loaded · ${nd} edited` : "none loaded"));
    sec.appendChild(head);
    const row = el("div", "tb-librow");
    const inp = el("input"); inp.type = "file"; inp.accept = ".json,application/json"; inp.multiple = true; inp.hidden = true;
    inp.addEventListener("change", () => { if (inp.files.length) libImport([...inp.files]); });
    const imp = el("button", "btn", "Import files…");
    imp.title = "Pick any number of RCT trainer .json files (e.g. everything in RCT_Trainers)";
    imp.addEventListener("click", () => inp.click());
    row.appendChild(imp); row.appendChild(inp);
    if (LIB.ids.length) {
      const cur = libCurrent();
      const k = LIB.ids.indexOf(cur);
      const prev = el("button", "btn ghost", "◀");
      prev.disabled = k <= 0;
      prev.addEventListener("click", () => libOpen(LIB.ids[k - 1]));
      const sel = el("select", "tb-libsel");
      sel.appendChild(opt("", "— scratch team (not a file) —", !cur));
      LIB.ids.forEach(id => sel.appendChild(opt(id, (LIB.dirty[id] ? "✎ " : "   ") + id, id === cur)));
      sel.addEventListener("change", () => libOpen(sel.value));
      const next = el("button", "btn ghost", "▶");
      next.disabled = k >= LIB.ids.length - 1;
      next.addEventListener("click", () => libOpen(LIB.ids[k + 1]));
      row.appendChild(prev); row.appendChild(sel); row.appendChild(next);
      const all = el("button", "btn", "Download all (.zip)");
      all.title = "Every loaded file, same names, ready to drop back into RCT_Trainers";
      all.addEventListener("click", () => libDownloadAll(all));
      row.appendChild(all);
      const clear = el("button", "btn ghost", "Unload all");
      clear.addEventListener("click", () => {
        if (nd && !confirm(`${nd} edited file(s) will be forgotten unless you downloaded them. Unload all?`)) return;
        LIB.ids.forEach(id => { try { localStorage.removeItem(FKEY(id)); } catch (e) {} });
        LIB = { ids: [], cur: "", dirty: {} }; libPersist(); libOpen("");
      });
      row.appendChild(clear);
    }
    sec.appendChild(row);
    sec.appendChild(el("i", "tb-hint", LIB.ids.length
      ? "Edits save as you go. ✎ marks files you changed. The zip holds every loaded file with its own name."
      : "Import a folder's worth of trainer files to edit them one after another, then download them all at once."));
    return sec;
  }

  /* -------------------------------------------------------------- data */
  let REWARD_ITEMS = null, STORY = null, SPECIES_IDS = null;
  const squash = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  /** the species an item's "user" name means: the longest leading part of
   *  "Species-Form-Words" that is a species id here, or null */
  function userSpecies(u) {
    if (!SPECIES_IDS) SPECIES_IDS = new Set((D().DB.index || []).map(r => squash(r.id)));
    const parts = String(u).split("-");
    for (let k = parts.length; k > 0; k--) {
      const n = squash(parts.slice(0, k).join("-"));
      if (SPECIES_IDS.has(n)) return n;
    }
    return null;
  }
  async function rewardItems() {
    if (!REWARD_ITEMS) REWARD_ITEMS = await D().dj("data/reward_items.json").catch(() => []);
    return REWARD_ITEMS;
  }
  async function storyTrainers() {
    if (!STORY) STORY = await D().dj("data/story_trainers.json").catch(() => []);
    return STORY;
  }
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

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
    // An item's users are Showdown names, often with a form on the end ("Necrozma-Ultra",
    // "Kommo-o-Totem", "Genesect-Douse"). Strip form words from the end until a species is
    // left, so Ultranecrozium-Z is Necrozma's and Porygonzite stays Porygon-Z's (claude/82).
    // A Mega Stone one of this species' forms names is always its own, whatever its users say.
    const me = String(full.id).toLowerCase().replace(/[^a-z0-9]/g, "");
    const ownStones = new Set((full.forms || []).filter(f => f.stone && f.stone.id)
      .map(f => String(f.stone.id).toLowerCase().replace(/[^a-z0-9]/g, "")));
    const legalItem = it => !it.user
      || it.user.some(u => userSpecies(u) === me)
      || (it.cat === "Mega Stone" && ownStones.has(String(it.bare).toLowerCase().replace(/[^a-z0-9]/g, "")));
    const usable = all.filter(legalItem);
    const cats = [];
    usable.forEach(it => { if (!cats.includes(it.cat)) cats.push(it.cat); });
    const itemSel = el("select", "tb-item");
    itemSel.appendChild(opt("", "— no held item —", !slot.heldItem));
    cats.forEach(c => {
      const g = el("optgroup"); g.label = c;
      usable.filter(it => it.cat === c)
        .sort((a, b) => a.name.localeCompare(b.name))
        // A datapack item (a vanilla item carrying Mega Showdown's components — most pack
        // Mega Stones, Gholdenium Z) is exported by its id like any other; the Cobblemon
        // Oblivion pipeline writes the full item with its components and the patched rctapi
        // reads them (claude/77).
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
      const row = all.find(x => x.bare.replace(/[^a-z0-9]/gi, "").toLowerCase() === want
                               && x.cat === "Mega Stone");
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
  async function buildExport(team) {
    team = team || T;
    const out = { name: team.name.trim() || "Custom Trainer" };
    if (team.identity.trim()) out.identity = team.identity.trim();
    out.ai = { type: "rct", data: { maxSelectMargin: +team.aiMargin } };
    out.battleRules = { maxItemUses: +team.maxItemUses };
    if (team.format && team.format !== "GEN_9_SINGLES") out.battleFormat = team.format;
    if (team.bag.length) {
      out.bag = team.bag.map(b => ({ item: b.item, quantity: +b.qty || 1 }));
    }
    out.team = [];
    const exportTeam = out.team;
    for (const slot of team.slots) {
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
      exportTeam.push(mon);
    }
    // Not an RCT field: the Cobblemon Oblivion pipeline reads it, gives the items and
    // CobbleDollars the first time a player beats this trainer, and removes it from the file.
    const rw = team.rewards || { items: [], cd: 0 };
    if (rw.items.length || +rw.cd > 0) {
      out.rewards = {};
      if (rw.items.length) out.rewards.items = rw.items.map(r => ({ item: r.item, count: +r.count || 1, name: r.name }));
      if (+rw.cd > 0) out.rewards.cobbledollars = Math.floor(+rw.cd);
    }
    // also ours: once beaten, the trainer can be challenged again this many in-game days later
    if (team.rematch && team.rematch.on) out.rematchDays = Math.max(1, Math.floor(+team.rematch.days || 1));
    return out;
  }

  // RCT writes the six stats with Showdown's short keys, not Cobblemon's long ones
  const EXPORT_STAT = {
    hp: "hp", attack: "atk", defence: "def",
    special_attack: "spa", special_defence: "spd", speed: "spe",
  };

  function fileName(team) {
    team = team || T;
    if (slug(team.fileId)) return slug(team.fileId) + ".json";
    const n = (team.name || "custom trainer").toLowerCase()
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
    // trainer files, trainer settings, rewards and the RCT export are developer tools;
    // players get the team, the suggester and a Clear button (?dev turns the rest on)
    const DEV = !!window.OBLIVION_DEV;
    if (DEV) wrap.appendChild(libraryPanel());

    if (!DEV) {
      const ph = el("section", "tb-meta");
      const phh = el("div", "tb-metahead");
      phh.appendChild(el("h2", null, "Your team"));
      phh.appendChild(el("span", "count", T.slots.filter(Boolean).length + " of 6"));
      const clr0 = el("button", "btn ghost", "Clear team");
      clr0.addEventListener("click", () => { T = blank(); save(); redraw(); });
      phh.appendChild(clr0);
      ph.appendChild(phh);
      const phint = el("p", "tb-hint", "Pick up to six Pokémon, or let the suggester build a team for you. Moves, abilities and items only offer what each Pokémon can really use.");
      phint.style.maxWidth = "none";
      ph.appendChild(phint);
      wrap.appendChild(ph);
    } else {
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

    const story = await storyTrainers();
    const fidIn = el("input");
    fidIn.placeholder = "roria_rival_jake_1";
    fidIn.value = T.fileId;
    fidIn.setAttribute("list", "tb-story-ids");
    const dlist = el("datalist");
    dlist.id = "tb-story-ids";
    story.forEach(s => dlist.appendChild(opt(s.id, s.name + (s.where ? " — " + s.where : ""))));
    fidIn.addEventListener("change", () => {
      T.fileId = slug(fidIn.value); fidIn.value = T.fileId;
      const s = story.find(x => x.id === T.fileId);
      if (s && !T.name.trim()) T.name = s.name;
      save(); redraw();
    });
    const idWrap = field("Trainer ID", fidIn);
    idWrap.appendChild(dlist);
    idWrap.appendChild(el("i", "tb-hint", "The file name. Pick a story trainer to replace its placeholder team."));
    mrow.appendChild(idWrap);

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

    /* rewards — given once, the first time a player beats this trainer */
    const RI = await rewardItems();
    const nameOfItem = id => (RI.find(r => r[0] === id) || [, id])[1];
    const rew = el("div", "tb-bag tb-rewards");
    rew.appendChild(el("span", "tb-rl", "Rewards"));
    T.rewards.items.forEach((r, n) => {
      const pill = el("span", "tb-pill");
      pill.appendChild(document.createTextNode(r.count + "× " + (r.name || r.item)));
      const x = el("button", "tb-x", "×");
      x.addEventListener("click", () => { T.rewards.items.splice(n, 1); save(); redraw(); });
      pill.appendChild(x);
      rew.appendChild(pill);
    });
    const ritem = el("input", "tb-ritem");
    ritem.placeholder = "item — e.g. Rare Candy";
    ritem.setAttribute("list", "tb-reward-items");
    const rlist = el("datalist");
    rlist.id = "tb-reward-items";
    RI.forEach(r => rlist.appendChild(opt(r[1], r[0])));
    const rcount = el("input", "tb-num");
    rcount.type = "number"; rcount.min = 1; rcount.max = 64; rcount.value = 1;
    const radd = el("button", "btn ghost", "Add");
    radd.addEventListener("click", () => {
      const v = ritem.value.trim();
      if (!v) return;
      // a name from the list (spaces, dashes and case don't matter, and a unique part of a
      // name is enough — "ultranecrozium" finds Ultranecrozium-Z), its id, or a raw
      // namespaced id for anything the list lacks
      const q = squash(v);
      let hit = RI.find(r => r[0] === v.toLowerCase()) || RI.find(r => squash(r[1]) === q)
             || RI.find(r => squash(r[0].split(":").pop()) === q);
      let many = 0;
      if (!hit && q.length >= 3) {
        const part = RI.filter(r => squash(r[1]).includes(q));
        if (part.length === 1) hit = part[0];
        many = part.length;
      }
      const id = hit ? hit[0] : (v.includes(":") ? v.toLowerCase() : null);
      if (!id) {
        ritem.value = "";
        ritem.placeholder = many > 1 ? `${many} items match “${v}” — pick one from the list`
                                     : "not an item — use a name from the list or mod:item";
        return;
      }
      const n = Math.max(1, Math.min(64, +rcount.value || 1));
      const ex = T.rewards.items.find(r => r.item === id);
      if (ex) ex.count = Math.min(64 * 36, ex.count + n);
      else T.rewards.items.push({ item: id, count: n, name: hit ? hit[1] : nameOfItem(id) });
      save(); redraw();
    });
    rew.appendChild(ritem); rew.appendChild(rlist); rew.appendChild(rcount); rew.appendChild(radd);
    const cdIn = el("input", "tb-num tb-cd");
    cdIn.type = "number"; cdIn.min = 0; cdIn.step = 50; cdIn.value = T.rewards.cd || 0;
    cdIn.addEventListener("change", () => { T.rewards.cd = Math.max(0, Math.floor(+cdIn.value || 0)); save(); redraw(); });
    rew.appendChild(field("CobbleDollars", cdIn));
    meta.appendChild(rew);

    /* rematch */
    const rm = el("div", "tb-bag tb-rematch");
    rm.appendChild(el("span", "tb-rl", "Rematch"));
    const chk = el("label", "tb-chk");
    const box = el("input"); box.type = "checkbox"; box.checked = !!T.rematch.on;
    box.addEventListener("change", () => { T.rematch.on = box.checked; save(); redraw(); });
    chk.appendChild(box);
    chk.appendChild(document.createTextNode(" Can be battled again every"));
    rm.appendChild(chk);
    const days = el("input", "tb-num");
    days.type = "number"; days.min = 1; days.max = 365; days.value = T.rematch.days || 1;
    days.disabled = !T.rematch.on;
    days.addEventListener("change", () => { T.rematch.days = Math.max(1, Math.floor(+days.value || 1)); save(); redraw(); });
    rm.appendChild(days);
    rm.appendChild(el("span", "tb-rmtxt", (+T.rematch.days || 1) === 1 ? "in-game day" : "in-game days"));
    meta.appendChild(rm);
    meta.appendChild(el("p", "tb-hint tb-rnote",
      (T.rematch.on
        ? "Each player can beat this trainer once, then challenge it again from sunrise " + ((+T.rematch.days || 1) === 1 ? "the next in-game day" : (+T.rematch.days) + " in-game days later") + ". The rewards come with every win. "
        : "Each player can beat this trainer once. ") +
      "Rewards replace RCT's random loot. All of this only works for trainers placed through Cobblemon Oblivion's pipeline — send the downloaded file."));
    wrap.appendChild(meta);
    }

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
    if (!DEV) return;
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
  const EXPORT_NOTES = [];
  function validate(data) {
    const out = EXPORT_NOTES.splice(0);
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
