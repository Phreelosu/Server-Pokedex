/* Zone Planner — #/zones (claude/62).
 *
 * Every CobbleZones zone on the server, with its encounter table. Tables start from the
 * auto-draft (assets/zonedraft.js); here you pin what you like, re-roll the rest, add or
 * remove species, and export the zone files back to config/CobbleZones/zones/.
 *
 * Baseline: data/zones.json (written by tools/zone_autofill.js). Your edits are kept in this
 * browser (localStorage) until you export or reset; "Import zone files" loads the live files
 * from the server so new zones or moved bounds are picked up.
 */
(function () {
  "use strict";
  const D = () => window.DEX;
  const ZD = () => window.ZoneDraft;
  const KEY = "zoneplanner.v1";
  const RAR = ["Common", "Uncommon", "Rare", "Very Rare", "Glitch"];

  let POOL = null, BYID = {}, BASE = null, S = null, HOST = null;
  const UI = { filter: "", add: "", addType: "", sel: null };

  /* ------------------------------------------------------------ state */
  function blankState(base) {
    return { zones: base.map(z => ({ file: z.file, zone: JSON.parse(JSON.stringify(z.zone)),
                                     tags: z.tags.slice(), levels: z.levels.slice(), pins: [], edited: false })),
             seed: 0 };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } }
  function load(base) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && Array.isArray(s.zones) && s.zones.length) return s;
    } catch (e) { /* ignore */ }
    return blankState(base);
  }
  const cur = () => S.zones.find(z => z.file === UI.sel) || S.zones[0];

  function usageExcept(file) {
    const u = {};
    S.zones.forEach(z => { if (z.file !== file) z.zone.encounters.forEach(e => { u[e.species] = (u[e.species] || 0) + 1; }); });
    return u;
  }
  const isPlaceholder = z => !z.encounters || !z.encounters.length ||
    (z.encounters.length === 1 && z.encounters[0].species === "pikachu" &&
     z.encounters[0].levelMin === 5 && z.encounters[0].levelMax === 8);

  function redraft(z, bump) {
    if (bump) z.seed = (z.seed || 0) + 1;
    const keep = z.zone.encounters.filter((e, i) => z.pins.includes(i));
    if (/fishing/i.test(z.zone.name) && z.zone.mode === "NORMAL") z.zone.mode = "FISHING";
    if (!z.zone.rarities || !z.zone.rarities.length) z.zone.rarities = ZD().rarities();
    ZD().rarities().forEach(r => { if (!z.zone.rarities.some(x => x.name === r.name)) z.zone.rarities.push(r); });
    z.zone.encounters = ZD().draft(z.zone, POOL, { tags: z.tags, levels: z.levels, seed: `${S.seed}.${z.seed || 0}`,
                                                   usage: usageExcept(z.file), keep, count: z.count });
    z.pins = keep.map((e, i) => i);
    z.edited = true;
  }

  /* ------------------------------------------------------------ export */
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {            // stored (uncompressed) zip: [{name, text}]
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = cen.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: "application/zip" });
  }
  const pretty = n => String(n).replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
  function locations() {
    const out = {};
    S.zones.forEach(z => z.zone.encounters.forEach(e => {
      if (e.enabled === false) return;
      const where = pretty(z.zone.name) + (z.zone.mode === "FISHING" ? " (fishing)" : "");
      const id = BYID[e.species] ? BYID[e.species].id : e.species;
      (out[id] = out[id] || []).includes(where) || out[id].push(where);
    }));
    return out;
  }
  function exportZip() {
    const files = S.zones.map(z => ({ name: "zones/" + z.file, text: JSON.stringify(z.zone, null, 2) }));
    files.push({ name: "locations.json", text: JSON.stringify({
      _comment: "Where each species can be found. Put this in the wiki's data folder.",
      _generated: "Zone Planner export", locations: locations() }, null, 1) });
    files.push({ name: "README.txt", text:
      "1. Copy everything in zones/ into  <server>/config/CobbleZones/zones/  (replace the old files).\r\n" +
      "2. In game, run  /cobblezones reload  (or restart the server).\r\n" +
      "3. Optional: copy locations.json into the wiki's data/ folder so each Pokedex page\r\n" +
      "   lists the zones where that species appears.\r\n" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip(files));
    a.download = "cobblezones-zones.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ------------------------------------------------------------ import */
  async function importFiles(list) {
    let updated = 0, added = 0, drafted = 0, bad = [];
    for (const f of list) {
      if (!/\.json$/i.test(f.name)) continue;
      let zone;
      try { zone = JSON.parse(await f.text()); } catch (e) { bad.push(f.name); continue; }
      if (!zone || !zone.pos1 || !zone.pos2 || !Array.isArray(zone.encounters)) { bad.push(f.name); continue; }
      let z = S.zones.find(x => x.file === f.name);
      if (z) { z.zone = zone; updated++; }
      else {
        z = { file: f.name, zone, tags: ZD().inferTags(zone), levels: ZD().inferLevels(zone), pins: [], edited: true };
        S.zones.push(z); added++;
      }
      if (isPlaceholder(zone)) { z.pins = []; redraft(z); drafted++; }
      else z.pins = [];
    }
    save(); render(HOST);
    alertBar(`Imported: ${updated} updated, ${added} new, ${drafted} auto-drafted` +
             (bad.length ? `. Skipped (not a zone file): ${bad.join(", ")}` : "") + ".");
  }
  let NOTE = "";
  function alertBar(t) { NOTE = t; const n = document.querySelector(".zp-note"); if (n) { n.textContent = t; n.hidden = !t; } }

  /* ------------------------------------------------------------ view helpers */
  function num(value, onChange, min, max) {
    const i = D().el("input", "zp-num");
    i.type = "number"; i.min = min; i.max = max; i.value = value;
    i.addEventListener("change", () => { const v = Math.max(min, Math.min(max, parseInt(i.value, 10) || min)); onChange(v); });
    return i;
  }
  function types(ts) { const w = D().el("span", "zp-types"); ts.forEach(t => { const c = D().chip(t); c.classList.add("sm"); w.appendChild(c); }); return w; }
  function variantOf(e) {
    const sp = BYID[e.species];
    if (!sp) return null;
    if (e.aspects && e.aspects.length) {
      const f = (sp.fm || []).find(f => f.a.join() === e.aspects.join());
      if (f) return { t: f.t, b: f.b, n: `${sp.n} (${f.n})` };
    }
    return { t: sp.t, b: sp.b, n: sp.n };
  }
  function newEntry(sp, form, z) {
    const lo = Math.max(z.levels[0], sp.l), hi = Math.max(lo, z.levels[1]);
    if (sp.g && !z.zone.rarities.some(r => r.name === ZD().GLITCH[0]))
      z.zone.rarities.push({ name: ZD().GLITCH[0], weight: ZD().GLITCH[1] });
    return { enabled: true, species: sp.sid || sp.id, form: "", aspects: form ? form.a.slice() : [],
             rarityCategory: sp.g ? ZD().GLITCH[0] : "Uncommon",
             spawnGroupMin: 0, spawnGroupMax: 0, shinyChancePercent: 0.0, levelMin: lo, levelMax: hi,
             timeWindow: "ANY", weatherCondition: "ANY", gender: "", nature: "", heldItems: [] };
  }

  /* ------------------------------------------------------------ render */
  function sidebar(el) {
    const side = el("aside", "zp-side");
    const q = el("input", "zp-filter");
    q.type = "search"; q.placeholder = "Filter zones…"; q.value = UI.filter;
    q.addEventListener("input", () => { UI.filter = q.value.toLowerCase(); paintList(); q.focus(); });
    side.appendChild(q);
    const list = el("div", "zp-list");
    side.appendChild(list);
    function paintList() {
      list.textContent = "";
      S.zones.slice().sort((a, b) => a.levels[0] - b.levels[0] || a.zone.name.localeCompare(b.zone.name))
        .filter(z => !UI.filter || z.zone.name.toLowerCase().includes(UI.filter) || z.tags.join(" ").includes(UI.filter))
        .forEach(z => {
          const b = el("button", "zp-item" + (z === cur() ? " on" : ""));
          const top = el("span", "zp-iname", pretty(z.zone.name));
          const sub = el("span", "zp-isub", `Lv ${z.levels[0]}–${z.levels[1]} · ${z.zone.encounters.length} · ` +
                         (z.zone.mode === "FISHING" ? "fishing" : z.tags.join(", ")));
          if (/fishing/i.test(z.zone.name) && z.zone.mode !== "FISHING") sub.appendChild(el("b", "zp-warnd", " · not in fishing mode"));
          if (isPlaceholder(z.zone)) sub.appendChild(el("b", "zp-warnd", " · empty"));
          b.append(top, sub);
          b.addEventListener("click", () => { UI.sel = z.file; render(HOST); });
          list.appendChild(b);
        });
    }
    paintList();
    return side;
  }

  function editor(el) {
    const z = cur();
    const main = el("section", "zp-main");
    if (!z) { main.appendChild(el("p", "tb-warn", "No zones loaded.")); return main; }
    const zone = z.zone;

    const head = el("div", "zp-head");
    const h = el("h2", null, pretty(zone.name));
    const meta = el("span", "zp-meta",
      `${zone.dimension.replace("minecraft:", "")} · ` +
      ["x", "y", "z"].map(a => `${a} ${Math.min(zone.pos1[a], zone.pos2[a])}…${Math.max(zone.pos1[a], zone.pos2[a])}`).join(", ") +
      ` · ${z.file}`);
    head.append(h, meta);
    main.appendChild(head);

    // settings
    const set = el("div", "zp-set");
    const mode = el("select", "zp-sel");
    [["NORMAL", "Walking encounters"], ["FISHING", "Fishing"], ["SPAWN", "Spawns around"]].forEach(([v, l]) => {
      const o = el("option", null, l); o.value = v; o.selected = zone.mode === v; mode.appendChild(o);
    });
    mode.addEventListener("change", () => { zone.mode = mode.value; z.edited = true; save(); render(HOST); });
    const lv = el("span", "zp-range");
    lv.append(el("span", "zp-lab", "Levels"),
      num(z.levels[0], v => { z.levels[0] = v; if (z.levels[1] < v) z.levels[1] = v; save(); render(HOST); }, 1, 100),
      el("span", "tb-dash", "–"),
      num(z.levels[1], v => { z.levels[1] = Math.max(v, z.levels[0]); save(); render(HOST); }, 1, 100));
    const cnt = el("span", "zp-range");
    cnt.append(el("span", "zp-lab", "Species"),
      num(z.count || (zone.mode === "FISHING" ? 7 : 10), v => { z.count = v; save(); }, 1, 40));
    const rd = el("button", "btn", "Re-draft unpinned");
    rd.title = "Keep the pinned species, re-roll the rest for these themes and levels";
    rd.addEventListener("click", () => { redraft(z, true); save(); render(HOST); });
    const apply = el("button", "btn ghost", "Apply levels to all");
    apply.title = "Set every species in this zone to the zone's level range (respecting how early each can exist)";
    apply.addEventListener("click", () => {
      zone.encounters.forEach(e => { const sp = BYID[e.species]; const lo = Math.max(z.levels[0], sp ? sp.l : 1);
        e.levelMin = lo; e.levelMax = Math.max(lo, z.levels[1]); });
      z.edited = true; save(); render(HOST);
    });
    set.append(el("span", "zp-lab", "Mode"), mode, lv, cnt, rd, apply);
    main.appendChild(set);

    const tagrow = el("div", "zp-tags");
    tagrow.appendChild(el("span", "zp-lab", "Themes"));
    Object.keys(ZD().TAGS).forEach(t => {
      const on = z.tags.includes(t);
      const b = el("button", "zp-tag" + (on ? " on" : ""), t);
      b.title = Object.entries(ZD().TAGS[t]).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(", ");
      b.addEventListener("click", () => {
        if (on) z.tags = z.tags.filter(x => x !== t); else z.tags.push(t);
        if (!z.tags.length) z.tags = [t];
        save(); render(HOST);
      });
      tagrow.appendChild(b);
    });
    tagrow.appendChild(el("span", "zp-hint", "first theme counts most · click to toggle, then Re-draft"));
    main.appendChild(tagrow);

    if (/fishing/i.test(zone.name) && zone.mode !== "FISHING")
      main.appendChild(el("p", "tb-problems", "This zone is named for fishing but is in walking mode: the bobber never checks it, so its table is never used. Set Mode to Fishing."));

    // encounter table
    const tbl = el("div", "zp-table");
    const hdr = el("div", "zp-row zp-hdr");
    ["Pin", "Species", "Types", "Rarity", "Levels", ""].forEach(t => hdr.appendChild(el("span", null, t)));
    tbl.appendChild(hdr);
    const order = zone.encounters.map((e, i) => i)
      .sort((a, b) => RAR.indexOf(zone.encounters[a].rarityCategory) - RAR.indexOf(zone.encounters[b].rarityCategory));
    order.forEach(i => {
      const e = zone.encounters[i], v = variantOf(e);
      const row = el("div", "zp-row" + (e.enabled === false ? " off" : ""));
      const pin = el("input"); pin.type = "checkbox"; pin.checked = z.pins.includes(i); pin.title = "Keep when re-drafting";
      pin.addEventListener("change", () => { z.pins = pin.checked ? z.pins.concat(i) : z.pins.filter(x => x !== i); save(); });
      const name = el("a", "zp-sp", v ? v.n : e.species + " (unknown)");
      name.href = "#/p/" + encodeURIComponent(BYID[e.species] ? BYID[e.species].id : e.species);
      if (!v) name.classList.add("bad");
      const rar = el("select", "zp-sel");
      (zone.rarities || []).map(r => r.name).forEach(r => { const o = el("option", null, r); o.value = r; o.selected = e.rarityCategory === r; rar.appendChild(o); });
      rar.addEventListener("change", () => { e.rarityCategory = rar.value; z.edited = true; save(); render(HOST); });
      const lv = el("span", "zp-range");
      const minL = BYID[e.species] ? BYID[e.species].l : 1;
      lv.append(num(e.levelMin, x => { e.levelMin = Math.max(x, 1); if (e.levelMax < e.levelMin) e.levelMax = e.levelMin; z.edited = true; save(); render(HOST); }, 1, 100),
                el("span", "tb-dash", "–"),
                num(e.levelMax, x => { e.levelMax = Math.max(x, e.levelMin); z.edited = true; save(); render(HOST); }, 1, 100));
      if (e.levelMin < minL) lv.appendChild(el("i", "zp-warnd", ` evolves at ${minL}`));
      const x = el("button", "tb-x", "×"); x.title = "Remove";
      x.addEventListener("click", () => {
        zone.encounters.splice(i, 1);
        z.pins = z.pins.filter(p => p !== i).map(p => p > i ? p - 1 : p);
        z.edited = true; save(); render(HOST);
      });
      row.append(pin, name, v ? types(v.t) : el("span"), rar, lv, x);
      tbl.appendChild(row);
    });
    main.appendChild(tbl);

    // rarity weights
    const rw = el("div", "zp-rw");
    rw.appendChild(el("span", "zp-lab", "Rarity weights"));
    (zone.rarities || []).forEach(r => {
      const n = zone.encounters.filter(e => e.rarityCategory === r.name).length;
      const w = el("label", "zp-wt");
      const inp = num(r.weight, v => { r.weight = v; z.edited = true; save(); render(HOST); }, 0, 1000);
      w.append(el("span", null, r.name), inp, el("i", null, n ? `${(chance(zone, r) * 100).toFixed(chance(zone, r) < 0.01 ? 2 : 1)}% each` : "unused"));
      rw.appendChild(w);
    });
    main.appendChild(rw);

    main.appendChild(addPanel(el, z));
    return main;
  }
  // chance of one specific species in this rarity, per encounter
  function chance(zone, r) {
    const used = (zone.rarities || []).filter(x => zone.encounters.some(e => e.rarityCategory === x.name && e.enabled !== false));
    const tot = used.reduce((s, x) => s + x.weight, 0);
    const n = zone.encounters.filter(e => e.rarityCategory === r.name && e.enabled !== false).length;
    return tot && n ? (r.weight / tot) / n : 0;
  }

  function addPanel(el, z) {
    const zone = z.zone;
    const wrap = el("div", "zp-add");
    wrap.appendChild(el("h3", null, "Add species"));
    const bar = el("div", "zp-addbar");
    const q = el("input", "tb-search"); q.type = "search"; q.placeholder = "Search any species or fakemon by name…"; q.value = UI.add;
    const ty = el("select", "zp-sel");
    [["", "Any type"]].concat(D().TYPE_ORDER.map(t => [t, D().cap(t)])).forEach(([v, l]) => {
      const o = el("option", null, l); o.value = v; o.selected = UI.addType === v; ty.appendChild(o);
    });
    bar.append(q, ty);
    wrap.appendChild(bar);
    const res = el("div", "zp-res");
    wrap.appendChild(res);
    const have = new Set(zone.encounters.map(e => e.species + "|" + (e.aspects || []).join()));
    function paint() {
      res.textContent = "";
      let rows;
      if (UI.add.length >= 2) {
        const s = UI.add.toLowerCase();
        rows = [];
        POOL.forEach(sp => {
          [null].concat(sp.fm || []).forEach(f => {
            const n = f ? `${sp.n} (${f.n})` : sp.n;
            if (!n.toLowerCase().includes(s) && !sp.id.includes(s)) return;
            const t = f ? f.t : sp.t;
            if (UI.addType && !t.includes(UI.addType)) return;
            rows.push({ sp, f, n, t, why: sp.x });
          });
        });
        rows = rows.slice(0, 40);
        res.appendChild(el("p", "zp-hint", `${rows.length === 40 ? "First 40" : rows.length} match${rows.length === 1 ? "" : "es"} — anything can be added by hand, including ones the draft skips.`));
      } else {
        const c = ZD().candidates(zone, POOL, { tags: z.tags, levels: z.levels, usage: usageExcept(z.file) })
          .filter(c => !UI.addType || c.v.t.includes(UI.addType))
          .sort((a, b) => b.w - a.w).slice(0, 30);
        rows = c.map(c => ({ sp: c.sp, f: c.v.a.length ? { a: c.v.a, n: c.v.n, t: c.v.t, b: c.v.b } : null,
                             n: c.v.a.length ? `${c.sp.n} (${c.v.n})` : c.sp.n, t: c.v.t }));
        res.appendChild(el("p", "zp-hint", "Best fits for this zone's themes and levels (less-used species first). Type to search everything."));
      }
      rows.forEach(r => {
        const k = (r.sp.sid || r.sp.id) + "|" + (r.f ? r.f.a.join() : "");
        const b = el("button", "zp-cand" + (have.has(k) ? " have" : ""));
        b.append(el("b", null, r.n), types(r.t), el("i", null, `BST ${r.f ? r.f.b : r.sp.b} · Lv ${r.sp.l}+ · ${r.sp.p}`));
        if (r.why || r.sp.g) b.appendChild(el("em", "zp-warnd", r.why || "glitch — goes in the Glitch rarity"));
        b.disabled = have.has(k);
        b.addEventListener("click", () => {
          zone.encounters.push(newEntry(r.sp, r.f, z));
          z.pins.push(zone.encounters.length - 1);
          z.edited = true; save(); render(HOST);
        });
        res.appendChild(b);
      });
    }
    q.addEventListener("input", () => { UI.add = q.value; paint(); });
    ty.addEventListener("change", () => { UI.addType = ty.value; paint(); });
    paint();
    return wrap;
  }

  function toolbar(el) {
    const bar = el("div", "zp-bar");
    bar.appendChild(el("h1", null, "Zone Planner"));
    const edited = S.zones.filter(z => z.edited).length;
    bar.appendChild(el("span", "tb-file", `${S.zones.length} zones · ${new Set(S.zones.flatMap(z => z.zone.encounters.map(e => e.species))).size} species used` +
                                          (edited ? ` · ${edited} changed here` : "")));
    const imp = el("label", "btn ghost", "Import zone files");
    const f = el("input"); f.type = "file"; f.multiple = true; f.accept = ".json,application/json"; f.hidden = true;
    f.addEventListener("change", () => importFiles(Array.from(f.files)));
    imp.appendChild(f);
    imp.title = "Pick the .json files from config/CobbleZones/zones — new zones get drafted, empty ones filled";
    const all = el("button", "btn ghost", "Re-draft all");
    all.title = "Re-roll every zone (pinned species stay)";
    all.addEventListener("click", () => {
      if (!confirmStep(all)) return;
      S.seed++;
      S.zones.slice().sort((a, b) => a.levels[0] - b.levels[0]).forEach(z => redraft(z));
      save(); render(HOST);
    });
    const reset = el("button", "btn ghost", "Reset");
    reset.title = "Forget changes made in this browser and go back to the published draft";
    reset.addEventListener("click", () => {
      if (!confirmStep(reset)) return;
      S = blankState(BASE); save(); render(HOST);
    });
    const exp = el("button", "btn", "Export zone files");
    exp.title = "Download a zip: zones/*.json for the server, plus locations.json for the wiki";
    exp.addEventListener("click", exportZip);
    bar.append(el("span", "zp-grow"), imp, all, reset, exp);
    return bar;
  }
  // two-click confirm without a browser dialog
  function confirmStep(btn) {
    if (btn.dataset.armed) return true;
    const label = btn.textContent;
    btn.dataset.armed = "1"; btn.textContent = "Click again to confirm";
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
    return false;
  }

  async function render(host) {
    HOST = host;
    const { el, dj } = D();
    if (!POOL) {
      host.textContent = "";
      host.appendChild(el("div", "wrap", "Loading zones…"));
      try {
        const [p, z] = await Promise.all([dj("data/zonepool.json"), dj("data/zones.json")]);
        POOL = p.species; BASE = z.zones;
        POOL.forEach(s => { BYID[s.id] = s; if (s.sid) BYID[s.sid] = s; });
        S = load(BASE);
      } catch (e) {
        host.textContent = "";
        host.appendChild(el("div", "wrap", "Zone data is missing (data/zones.json, data/zonepool.json)."));
        return;
      }
    }
    const scrollY = window.scrollY;
    host.textContent = "";
    const wrap = el("div", "wrap zp");
    wrap.appendChild(toolbar(el));
    const note = el("p", "zp-note", NOTE); note.hidden = !NOTE; wrap.appendChild(note);
    const body = el("div", "zp-body");
    body.append(sidebar(el), editor(el));
    wrap.appendChild(body);
    host.appendChild(wrap);
    window.scrollTo(0, scrollY);
  }

  window.ZonePlanner = { render, _state: () => S, _import: importFiles, _zip: zip };
})();
