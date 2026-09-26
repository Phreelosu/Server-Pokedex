(function () {
  "use strict";

  // Stamped by tools/wiki_data.py on every build. Every data file is fetched with it, so
  // a rebuilt Pokedex never shows through a browser's cached copy of the old one — which
  // is exactly what hid the Mega Showdown forms after they were added.
  const BUILD = "20260926155404";
  const dj = p => fetch(p + (p.indexOf("?") < 0 ? "?v=" : "&v=") + BUILD).then(r => r.json());

  const TYPE = {
    normal:"#8D9280", fire:"#D2622F", water:"#3F82C4", electric:"#C2941A", grass:"#4E9243",
    ice:"#4FADB6", fighting:"#B03F36", poison:"#8B4E96", ground:"#A5763A", flying:"#6F84C8",
    psychic:"#CC5678", bug:"#7E8C36", rock:"#918049", ghost:"#5A63A0", dragon:"#4257B8",
    dark:"#544D46", steel:"#647F8E", fairy:"#C673A8", stellar:"#3E9B8E", cosmic:"#6B4E9B",
    sound:"#4E8F9B", light:"#C9A73C", crystal:"#7FB4C4", nuclear:"#7FA83C", shadow:"#3B3A47",
  };
  const TYPE_ORDER = ["normal","fire","water","electric","grass","ice","fighting","poison","ground",
                      "flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
  const STATS = [["hp","HP"],["attack","Atk"],["defence","Def"],
                 ["special_attack","SpA"],["special_defence","SpD"],["speed","Spe"]];
  const STAT_COLOR = ["#C05A4A","#CE7B33","#C4A02F","#4C8F5B","#3F7FBF","#7B62B5"];

  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const typeColor = t => TYPE[String(t).toLowerCase()] || "#7A7F72";
  const cap = s => String(s || "").replace(/(^|[\s\-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  function chip(t) {
    const c = el("span", "ty", t);
    c.style.background = typeColor(t);
    return c;
  }

  /* ------------------------------------------------------------ data */
  const DB = { index: [], byId: {}, moves: {}, abilities: {}, models: {}, locations: {}, counts: {} };

  async function boot() {
    const [idx, moves, abil] = await Promise.all([
      dj("data/index.json"),
      dj("data/moves.json").catch(() => ({})),
      dj("data/abilities.json").catch(() => ({})),
    ]);
    DB.index = idx.species; DB.counts = idx.counts;
    DB.index.forEach(r => { DB.byId[r.id] = r; });
    // one fixed walking order for the whole dex, independent of whatever the list view is
    // filtered or sorted by — the arrows should always mean "the next number up"
    DB.order = DB.index.slice().sort((a, b) =>
      (a.d == null) - (b.d == null) || (a.d - b.d) || a.id.localeCompare(b.id));
    DB.pos = {};
    DB.order.forEach((r, i) => { DB.pos[r.id] = i; });
    DB.moves = moves; DB.abilities = abil;
    // optional extras — the site works without either
    DB.models = await dj("data/models.json").catch(() => ({}));
    const loc = await dj("data/locations.json").catch(() => null);
    DB.locations = (loc && loc.locations) || {};
    $("#brandsub").textContent =
      `${DB.counts.total} species · ${DB.counts.megas} Megas · ${DB.counts.forms} extra forms`;
    flagsLoad();
    mountFlagButton();
    route();
  }

  /* ------------------------------------------------------------ list */
  const F = { q: "", types: new Set(), source: "all", mega: false, forms: false, sort: "dex", shown: 0 };
  const PAGE = 120;

  function matches(r) {
    if (F.source === "custom" && r.v) return false;
    if (F.source === "vanilla" && !r.v) return false;
    if (F.mega && !r.m) return false;
    if (F.forms && !r.f) return false;
    if (F.types.size) {
      for (const t of F.types) if (!r.t.includes(t)) return false;
    }
    if (F.q) {
      const q = F.q.toLowerCase();
      if (!(r.n.toLowerCase().includes(q) || String(r.d) === q ||
            r.t.some(t => t.startsWith(q)))) return false;
    }
    return true;
  }

  function sorted(rows) {
    const s = F.sort;
    const c = {
      dex: (a, b) => (a.d || 1e9) - (b.d || 1e9),
      name: (a, b) => a.n.localeCompare(b.n),
      bst: (a, b) => b.b - a.b,
    }[s] || ((a, b) => (b.s[s] || 0) - (a.s[s] || 0));
    return rows.slice().sort(c);
  }

  function card(r) {
    const c = el("div", "card");
    c.tabIndex = 0;
    const n = el("div", "n");
    n.appendChild(el("span", "num", r.d != null ? "#" + String(r.d).padStart(4, "0") : "—"));
    n.appendChild(el("h3", null, r.n));
    c.appendChild(n);
    const tw = el("div", "types");
    r.t.forEach(t => tw.appendChild(chip(t)));
    c.appendChild(tw);
    const sp = el("div", "spark");
    STATS.forEach(([k], i) => {
      const b = document.createElement("i");
      b.style.height = Math.max(10, Math.min(100, ((r.s[k] || 0) / 165) * 100)) + "%";
      b.style.background = STAT_COLOR[i];
      b.title = `${k.replace(/_/g, " ")}: ${r.s[k] || 0}`;
      sp.appendChild(b);
    });
    c.appendChild(sp);
    const f = el("div", "foot2");
    f.appendChild(el("span", null, "BST " + r.b));
    if (r.m) { const b = el("span", "badge", r.m > 1 ? r.m + " Megas" : "Mega"); f.appendChild(b); }
    else if (r.f) { f.appendChild(el("span", "badge alt", r.f + (r.f > 1 ? " forms" : " form"))); }
    c.appendChild(f);
    const go = () => { location.hash = "#/p/" + r.id; };
    c.addEventListener("click", go);
    c.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    return c;
  }

  function renderList() {
    const v = $("#view");
    v.innerHTML = "";
    v.appendChild($("#tpl-list").content.cloneNode(true));

    const tw = $("#types");
    TYPE_ORDER.forEach(t => {
      const b = document.createElement("button");
      b.className = "ty" + (F.types.has(t) ? " on" : "");
      b.style.background = typeColor(t);
      b.style.color = "#fff";
      b.textContent = t;
      b.addEventListener("click", () => {
        F.types.has(t) ? F.types.delete(t) : F.types.add(t);
        F.shown = 0; renderList();
      });
      tw.appendChild(b);
    });
    $("#source").querySelectorAll("button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === F.source);
      b.addEventListener("click", () => { F.source = b.dataset.v; F.shown = 0; renderList(); });
    });
    $("#onlymega").checked = F.mega;
    $("#onlymega").addEventListener("change", e => { F.mega = e.target.checked; F.shown = 0; renderList(); });
    $("#onlyforms").checked = F.forms;
    $("#onlyforms").addEventListener("change", e => { F.forms = e.target.checked; F.shown = 0; renderList(); });
    $("#sort").value = F.sort;
    $("#sort").addEventListener("change", e => { F.sort = e.target.value; F.shown = 0; renderList(); });
    $("#clear").addEventListener("click", () => {
      F.q = ""; F.types.clear(); F.source = "all"; F.mega = false; F.forms = false;
      F.sort = "dex"; F.shown = 0; $("#q").value = ""; renderList();
    });

    const rows = sorted(DB.index.filter(matches));
    $("#count").textContent = rows.length + (rows.length === 1 ? " species" : " species");
    const grid = $("#grid"), more = $("#more");
    grid.innerHTML = "";
    if (!rows.length) {
      grid.appendChild(el("div", "empty", "Nothing matches those filters."));
      return;
    }
    F.shown = Math.max(F.shown, PAGE);
    const draw = () => {
      grid.innerHTML = "";
      rows.slice(0, F.shown).forEach(r => grid.appendChild(card(r)));
      more.innerHTML = "";
      if (rows.length > F.shown) {
        const b = el("button", "ghost", `Show more — ${rows.length - F.shown} left`);
        b.addEventListener("click", () => { F.shown += PAGE * 2; draw(); });
        more.appendChild(b);
      }
    };
    draw();
  }

  /* ---------------------------------------------------------- detail */
  let viewer = null;

  function statRow(grid, key, label, value, max) {
    grid.appendChild(el("span", "k", label));
    const t = el("span", "t"); const i = document.createElement("i");
    i.style.width = Math.max(2, Math.min(100, (value / max) * 100)) + "%";
    i.style.background = STAT_COLOR[STATS.findIndex(s => s[0] === key)] || "var(--accent)";
    t.appendChild(i); grid.appendChild(t);
    grid.appendChild(el("span", "v", String(value)));
  }

  // Some species are only ever drawn through an aspect the game hands out at runtime
  // rather than one a form declares — a gender (Gigalith's ore type, Fungalith's
  // male/female) or a feature choice (Hacnea's carved face). Every real Pokemon has one,
  // so a row asking for it still applies. Anything a form of this species DOES declare
  // (mega, gmax, hisuian) stays that form's and is never borrowed.
  function runtimeAspects(sid, forms) {
    const declared = new Set();
    for (const f of forms || [])
      for (const a of f.aspects || []) declared.add(String(a).toLowerCase());
    const out = new Set();
    for (const r of DB.models[sid] || [])
      for (const a of r.aspects || []) {
        const k = String(a).toLowerCase();
        if (!declared.has(k)) out.add(k);
      }
    return out;
  }

  function pickModel(sid, aspects, forms) {
    const rows = DB.models[sid];
    if (!rows || !rows.length) return null;
    const want = new Set((aspects || []).map(a => String(a).toLowerCase()));
    const free = runtimeAspects(sid, forms);
    let best = null, bestScore = -1;
    for (const r of rows) {
      const ra = (r.aspects || []).map(a => String(a).toLowerCase());
      if (ra.some(a => !want.has(a) && !free.has(a))) continue;   // needs something we can't have
      // prefer the row that matches this form most specifically, counting only the
      // aspects the form actually declares
      const score = ra.filter(a => want.has(a)).length * 100 - ra.length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    // a model in the wrong pose beats an empty box
    return best || rows.find(r => !(r.aspects || []).length) || rows[0] || null;
  }

  async function renderDetail(id) {
    const v = $("#view");
    v.innerHTML = "";
    let d;
    try {
      d = await dj("data/species/" + encodeURIComponent(id) + ".json");
    } catch (e) {
      v.appendChild(el("div", "empty", "No page for “" + id + "”."));
      return;
    }
    document.title = d.name + " · Pokédex";

    const wrap = el("div", "wrap");
    v.appendChild(wrap);
    wrap.appendChild(pager(d.id));

    let formIndex = 0;

    const hero = el("div", "hero");
    wrap.appendChild(hero);

    /* ---- viewer ---- */
    const vbox = el("div", "viewer");
    const canvas = document.createElement("canvas");
    vbox.appendChild(canvas);
    const note = el("div", "vnote");
    vbox.appendChild(note);
    const tools = el("div", "vtools");
    const bSpin = el("button", "ghost", "Pause");
    const bReset = el("button", "ghost", "Reset");
    const bShiny = el("button", "ghost", "Shiny");
    tools.appendChild(bSpin); tools.appendChild(bReset); tools.appendChild(bShiny);
    let shinyOn = false;
    vbox.appendChild(tools);
    hero.appendChild(vbox);

    /* ---- identity ---- */
    const idt = el("div", "idt");
    hero.appendChild(idt);
    const titlerow = el("div", "titlerow");
    const h1 = el("h1", null, d.name);
    titlerow.appendChild(h1);
    const fBtn = el("button", "flagtoggle");
    titlerow.appendChild(fBtn);
    idt.appendChild(titlerow);

    const fNote = document.createElement("input");
    fNote.type = "text";
    fNote.className = "flagnote";
    fNote.placeholder = "What's wrong with it? (optional)";

    function paintFlag() {
      const on = !!FLAGS.species[d.id];
      fBtn.textContent = on ? "⚑ Flagged" : "⚑ Flag";
      fBtn.classList.toggle("on", on);
      fBtn.title = on ? "Remove this flag" : "Flag this species for fixing";
      fNote.hidden = !on;
      if (on) fNote.value = FLAGS.species[d.id].note || "";
    }
    fBtn.addEventListener("click", () => {
      if (FLAGS.species[d.id]) delete FLAGS.species[d.id];
      else FLAGS.species[d.id] = { name: d.name, dex: d.dex, note: "" };
      flagsSave(); paintFlag();
      if (!fNote.hidden) fNote.focus();
    });
    fNote.addEventListener("input", () => {
      const f = FLAGS.species[d.id];
      if (f) { f.note = fNote.value.trim(); flagsSave(); }
    });
    paintFlag();
    idt.appendChild(el("div", "sub",
      (d.dex != null ? "#" + String(d.dex).padStart(4, "0") : "unnumbered") +
      (d.vanilla ? " · official" : " · custom")));
    idt.appendChild(fNote);
    const tRow = el("div", "types");
    idt.appendChild(tRow);
    const flav = el("p", "flavour");
    idt.appendChild(flav);
    // Which stone triggers this Mega. Knowing the id is the thing you actually want when
    // you are standing in a server console, so it is one click to copy the /give.
    const stoneRow = el("div", "stone");
    stoneRow.hidden = true;
    idt.appendChild(stoneRow);

    // Where this form came from. Two facts, because they are often different packs:
    // Cobblemon defines all 1025 official species, but the model you are looking at may
    // have been supplied by an addon on top of it.
    const srcRow = el("div", "source");
    idt.appendChild(srcRow);

    const formbar = el("div", "formbar");
    idt.appendChild(formbar);

    const sg = el("div", "statgrid");
    idt.appendChild(sg);
    const tot = el("div", "total");
    idt.appendChild(tot);

    function paintForm() {
      const f = d.forms[formIndex] || d.forms[0];
      tRow.innerHTML = "";
      f.types.forEach(t => tRow.appendChild(chip(t)));
      const text = f.dex || d.dexEntry;
      flav.textContent = text || "No Pokédex entry has been written for this one yet.";
      flav.classList.toggle("none", !text);
      stoneRow.innerHTML = "";
      stoneRow.hidden = !f.stone;
      if (f.stone) buildStone(stoneRow, f.stone);
      srcRow.innerHTML = "";
      srcRow.hidden = !(f.source || f.art);
      if (f.source || f.art) {
        const add = (k, v) => {
          const b = el("span", "src");
          b.appendChild(el("i", null, k));
          b.appendChild(document.createTextNode(v));
          srcRow.appendChild(b);
        };
        if (f.source) add("from ", f.source);
        if (f.art && f.art !== f.source) add("model by ", f.art);
      }
      sg.innerHTML = "";
      const max = Math.max(160, ...STATS.map(([k]) => f.stats[k] || 0));
      STATS.forEach(([k, lbl]) => statRow(sg, k, lbl, f.stats[k] || 0, max));
      tot.innerHTML = "";
      tot.appendChild(el("span", null, "Total"));
      const b = document.createElement("b"); b.textContent = String(f.bst);
      tot.appendChild(b);
      formbar.querySelectorAll("button").forEach((btn, i) => btn.classList.toggle("on", i === formIndex));
      loadModel(f);
      renderAbilities(f);
    }

    d.forms.forEach((f, i) => {
      const b = document.createElement("button");
      b.textContent = f.name;
      if (f.mega) { const s = el("span", "mg", "MEGA"); b.appendChild(s); }
      else if (f.battleOnly) { const s = el("span", "mg", "BATTLE"); b.appendChild(s); }
      b.addEventListener("click", () => { formIndex = i; paintForm(); });
      formbar.appendChild(b);
    });
    if (d.forms.length < 2) formbar.style.display = "none";

    /* ---- panels ---- */
    const pAb = el("section", "panel");
    pAb.appendChild(el("h2", null, "Abilities"));
    const abBox = el("div");
    pAb.appendChild(abBox);
    wrap.appendChild(pAb);

    function renderAbilities(f) {
      abBox.innerHTML = "";
      (f.abilities || []).forEach(a => {
        const row = el("div", "ability");
        const b = document.createElement("b"); b.textContent = a.name;
        row.appendChild(b);
        if (a.hidden) row.appendChild(el("span", "h", "hidden"));
        const meta = DB.abilities[a.id];
        if (meta && meta.desc) row.appendChild(el("p", null, meta.desc));
        abBox.appendChild(row);
      });
      if (!abBox.children.length) abBox.appendChild(el("p", "locnone", "No abilities listed."));
    }

    /* where to find it */
    const pLoc = el("section", "panel");
    pLoc.appendChild(el("h2", null, "Where to find it"));
    const locs = DB.locations[d.id] || DB.locations[d.stem];
    if (Array.isArray(locs) && locs.length) {
      const lw = el("div", "locations");
      locs.forEach(l => lw.appendChild(el("span", "loc", l)));
      pLoc.appendChild(lw);
    } else {
      pLoc.appendChild(el("p", "locnone", "No location set yet."));
    }
    wrap.appendChild(pLoc);

    /* evolutions */
    if ((d.evolutions && d.evolutions.length) || d.preEvolution) {
      const pEv = el("section", "panel");
      pEv.appendChild(el("h2", null, "Evolution"));
      const box = el("div", "evo");
      if (d.preEvolution) {
        const s = el("div", "evostep");
        const a = el("a", null, nameOf(d.preEvolution));
        a.href = "#/p/" + d.preEvolution;
        s.appendChild(a);
        s.appendChild(el("span", "arrow", "→"));
        s.appendChild(el("span", null, d.name));
        box.appendChild(s);
      }
      (d.evolutions || []).forEach(e => {
        const s = el("div", "evostep");
        s.appendChild(el("span", null, e.fromForm ? d.name + " (" + e.fromForm + ")" : d.name));
        s.appendChild(el("span", "arrow", "→"));
        if (DB.byId[e.to]) {
          const a = el("a", null, nameOf(e.to) + (e.aspect ? " " + e.aspect : ""));
          a.href = "#/p/" + e.to;
          s.appendChild(a);
        } else {
          s.appendChild(el("span", null, cap(e.toRaw || e.to)));
        }
        s.appendChild(el("span", "how", e.how));
        box.appendChild(s);
      });
      pEv.appendChild(box);
      wrap.appendChild(pEv);
    }

    /* breeding + training */
    const pInfo = el("section", "panel");
    pInfo.appendChild(el("h2", null, "Details"));
    const cols = el("div", "cols");
    const dl1 = el("dl", "kv");
    const add = (dl, k, val) => {
      if (val == null || val === "" || (Array.isArray(val) && !val.length)) return;
      dl.appendChild(el("dt", null, k));
      dl.appendChild(el("dd", null, Array.isArray(val) ? val.join(", ") : String(val)));
    };
    add(dl1, "Egg groups", d.eggGroups);
    add(dl1, "Egg cycles", d.eggCycles);
    add(dl1, "Gender", d.maleRatio === -1 ? "Genderless"
        : d.maleRatio != null ? Math.round(d.maleRatio * 100) + "% male" : null);
    add(dl1, "Friendship", d.baseFriendship);
    cols.appendChild(dl1);
    const dl2 = el("dl", "kv");
    add(dl2, "Catch rate", d.catchRate);
    add(dl2, "EXP group", d.experienceGroup);
    add(dl2, "Base EXP", d.baseExperienceYield);
    add(dl2, "EV yield", Object.entries(d.evYield || {})
        .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`));
    cols.appendChild(dl2);
    const dl3 = el("dl", "kv");
    add(dl3, "Height", d.height != null ? (d.height / 10).toFixed(1) + " m" : null);
    add(dl3, "Weight", d.weight != null ? (d.weight / 10).toFixed(1) + " kg" : null);
    add(dl3, "Forms", d.forms.length);
    add(dl3, "Labels", d.labels.filter(x => !/^gen\d/.test(x)));
    cols.appendChild(dl3);
    pInfo.appendChild(cols);
    wrap.appendChild(pInfo);

    /* moves */
    let drawMovesIfAny = () => {};
    const buckets = Object.keys(d.moves || {}).filter(k => (d.moves[k] || []).length);
    if (buckets.length) {
      const pMv = el("section", "panel");
      pMv.appendChild(el("h2", null, "Moves"));
      const tabs = el("div", "tabs");
      const tw = el("div", "tablewrap");
      const LABEL = { level: "By level", tm: "TM", egg: "Egg", tutor: "Tutor", legacy: "Legacy", special: "Special" };
      const order = ["level", "tm", "egg", "tutor", "special", "legacy"]
        .filter(b => buckets.includes(b)).concat(buckets.filter(b => !["level","tm","egg","tutor","special","legacy"].includes(b)));
      let cur = order[0];
      const drawMoves = () => {
        tabs.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.b === cur));
        tw.innerHTML = "";
        const table = el("table", "moves");
        const thead = document.createElement("thead");
        const hr = document.createElement("tr");
        (cur === "level" ? ["Lv", "Move", "Type", "Cat", "Pwr", "Acc", "PP", "Effect", ""]
                         : ["Move", "Type", "Cat", "Pwr", "Acc", "PP", "Effect", ""])
          .forEach(h => hr.appendChild(el("th", null, h)));
        thead.appendChild(hr); table.appendChild(thead);
        const tb = document.createElement("tbody");
        (d.moves[cur] || []).forEach(m => {
          const meta = DB.moves[m.id] || {};
          const tr = document.createElement("tr");
          if (cur === "level") tr.appendChild(el("td", "num", String(m.level)));
          tr.appendChild(el("td", null, meta.name || m.name));
          const tdT = document.createElement("td");
          if (meta.type) tdT.appendChild(chip(String(meta.type).toLowerCase()));
          tr.appendChild(tdT);
          const tdC = document.createElement("td");
          if (meta.category) tdC.appendChild(el("span", "cat " + String(meta.category).toLowerCase(), meta.category));
          tr.appendChild(tdC);
          tr.appendChild(el("td", "num", meta.power ? String(meta.power) : "—"));
          tr.appendChild(el("td", "num", meta.accuracy === true ? "—" : (meta.accuracy != null ? meta.accuracy : "—")));
          tr.appendChild(el("td", "num", meta.pp != null ? String(meta.pp) : "—"));
          tr.appendChild(el("td", "eff", meta.desc || ""));

          // A move the merged pack never defines shows a name and six dashes. Mark it,
          // so a page full of fine moves doesn't have to be read cell by cell.
          const bare = !DB.moves[m.id];
          if (bare) {
            tr.classList.add("nometa");
            tr.title = "No move data in the pack — the game has nothing to load for this one either.";
          }
          const tdF = el("td", "flagcell");
          const fb = el("button", "flagmove", "⚑");
          const paint = () => {
            const on = !!FLAGS.moves[m.id];
            fb.classList.toggle("on", on);
            fb.title = on ? "Flagged — click to remove" : "Flag this move";
          };
          fb.addEventListener("click", () => {
            if (FLAGS.moves[m.id]) delete FLAGS.moves[m.id];
            else FLAGS.moves[m.id] = {
              name: meta.name || m.name || cap(m.id),
              note: bare ? "no stats" : "",
              on: d.name, onId: d.id,
            };
            flagsSave(); paint();
          });
          paint();
          tdF.appendChild(fb);
          tr.appendChild(tdF);
          tb.appendChild(tr);
        });
        table.appendChild(tb);
        tw.appendChild(table);
      };
      order.forEach(b => {
        const btn = document.createElement("button");
        btn.dataset.b = b;
        btn.textContent = (LABEL[b] || cap(b)) + " (" + d.moves[b].length + ")";
        btn.addEventListener("click", () => { cur = b; drawMoves(); });
        tabs.appendChild(btn);
      });
      pMv.appendChild(tabs); pMv.appendChild(tw);
      wrap.appendChild(pMv);
      drawMoves();
      drawMovesIfAny = drawMoves;
    }

    /* ---- 3D ---- */
    function loadModel(f) {
      const pick = pickModel(d.id, f.aspects, d.forms);
      if (!pick) {
        note.textContent = Object.keys(DB.models).length
          ? "No model shipped for this form."
          : "Models aren't built yet — run build-assets.py and reload.";
        note.style.display = "flex";
        canvas.style.visibility = "hidden";
        return;
      }
      note.textContent = "Loading…";
      note.style.display = "flex";
      canvas.style.visibility = "visible";
      try {
        if (!viewer) viewer = window.BedrockViewer.create(canvas);
      } catch (e) {
        note.textContent = "This browser can't do WebGL.";
        return;
      }
      // The shiny texture rides along on the same model row, so this is a texture swap
      // and nothing else — no second model, no second pose.
      const hasShiny = !!pick.shiny;
      bShiny.hidden = !hasShiny;
      if (!hasShiny) shinyOn = false;
      bShiny.classList.toggle("on", shinyOn);
      bShiny.textContent = shinyOn ? "Normal" : "Shiny";
      viewer.load(pick.model, shinyOn && pick.shiny ? pick.shiny : pick.texture,
                  pick.pose, pick.layers)
        .then(() => { note.style.display = "none"; })
        .catch(err => { note.textContent = "Couldn't render this model."; note.style.display = "flex"; });
    }
    bShiny.addEventListener("click", () => {
      shinyOn = !shinyOn;
      loadModel(d.forms[formIndex] || d.forms[0]);
    });
    bSpin.addEventListener("click", () => { bSpin.textContent = viewer && viewer.toggleSpin() ? "Pause" : "Spin"; });
    bReset.addEventListener("click", () => viewer && viewer.reset());

    wrap.appendChild(pager(d.id));

    refreshFlagUI = () => { paintFlag(); drawMovesIfAny(); };

    paintForm();
    window.scrollTo(0, 0);
  }

  function nameOf(id) { return (DB.byId[id] && DB.byId[id].n) || cap(id); }

  /* ------------------------------------------------------- walking the dex */
  const dexNo = r => r && r.d != null ? "#" + String(r.d).padStart(4, "0") : "";

  function neighbours(id) {
    const i = DB.pos[id];
    if (i == null) return [null, null];
    return [DB.order[i - 1] || null, DB.order[i + 1] || null];
  }

  function pager(id) {
    const [prev, next] = neighbours(id);
    const bar = el("nav", "pager");
    bar.setAttribute("aria-label", "Dex navigation");
    const side = (r, dir) => {
      if (!r) return el("span", "pg empty2");
      const a = el("a", "pg " + dir);
      a.href = "#/p/" + encodeURIComponent(r.id);
      a.appendChild(el("span", "arw", dir === "prev" ? "←" : "→"));
      const t = el("span", "pgt");
      t.appendChild(el("b", null, r.n));
      t.appendChild(el("i", null, dexNo(r)));
      a.appendChild(t);
      a.title = (dir === "prev" ? "Previous" : "Next") + ": " + r.n + "  (" +
                (dir === "prev" ? "←" : "→") + ")";
      return a;
    };
    bar.appendChild(side(prev, "prev"));
    const mid = el("a", "pg mid", "All species");
    mid.href = "#/";
    bar.appendChild(mid);
    bar.appendChild(side(next, "next"));
    return bar;
  }

  function step(dir) {
    const m = (location.hash || "").match(/^#\/p\/(.+)$/);
    if (!m) return;
    const [prev, next] = neighbours(decodeURIComponent(m[1]));
    const to = dir < 0 ? prev : next;
    if (to) location.hash = "#/p/" + encodeURIComponent(to.id);
  }

  // What a player needs about a Mega Stone is its name and how to get one — the item id
  // is for the server console, and lives in reports/mega-stones.md instead.
  const ING_COLOR = ["#3B4CA8", "#2C7A5B", "#9A6A12", "#B03F36", "#8B4E96", "#4E8F9B",
                     "#918049", "#C673A8", "#647F8E"];

  function buildStone(host, stone) {
    host.appendChild(el("span", "stonelbl", "Mega Stone"));
    const body = el("div", "stonebody");
    host.appendChild(body);
    body.appendChild(el("b", null, stone.name));

    const r = stone.recipe;
    if (!r) {
      body.appendChild(el("span", "stonenote", "No crafting recipe — ask an admin for one."));
      return;
    }
    if (r.kind === "crafting_shaped" && r.grid) {
      // one colour per distinct ingredient, so the shape reads at a glance
      const order = Object.keys(r.keys || {});
      const colOf = k => ING_COLOR[order.indexOf(k) % ING_COLOR.length];
      const wrap = el("div", "craft");
      const g = el("div", "grid3");
      r.grid.forEach(row => row.forEach(c => {
        const cell = el("i", "cell");
        if (c !== " " && (r.keys || {})[c]) {
          cell.style.background = colOf(c);
          cell.classList.add("on");
          cell.title = r.keys[c].join(" or ");
        }
        g.appendChild(cell);
      }));
      wrap.appendChild(g);
      const legend = el("ul", "legend");
      order.forEach(k => {
        const li = document.createElement("li");
        const dot = el("i", "dot");
        dot.style.background = colOf(k);
        li.appendChild(dot);
        li.appendChild(el("span", null, r.keys[k].join(" or ")));
        legend.appendChild(li);
      });
      wrap.appendChild(legend);
      body.appendChild(wrap);
      return;
    }
    const what = r.kind === "smithing_transform" ? "Smithing table" : "Crafting, any order";
    body.appendChild(el("span", "stonenote", what + ": " + (r.items || []).join(", ")));
  }

  /* --------------------------------------------------------------- flags
     A notepad for walking the dex looking for things to fix. Lives in this browser only
     — localStorage, never sent anywhere — and exists so the list can be handed over as
     text at the end instead of kept in a separate file alongside 2,367 pages. */
  const FLAGS = { species: {}, moves: {} };
  const FKEY = "dex-flags-v1";

  function flagsLoad() {
    try {
      const raw = localStorage.getItem(FKEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        FLAGS.species = d.species || {};
        FLAGS.moves = d.moves || {};
      }
    } catch (e) {}          // private window, cleared site data — start empty, no drama
  }

  function flagsSave() {
    try { localStorage.setItem(FKEY, JSON.stringify(FLAGS)); } catch (e) {}
    flagsPaintCount();
  }

  const flagCount = () => Object.keys(FLAGS.species).length + Object.keys(FLAGS.moves).length;

  function flagsPaintCount() {
    const b = $("#flagbtn");
    if (!b) return;
    const n = flagCount();
    b.querySelector("i").textContent = n ? String(n) : "";
    b.classList.toggle("has", !!n);
  }

  function flagsText() {
    const sp = Object.entries(FLAGS.species)
      .sort((a, b) => (a[1].dex == null) - (b[1].dex == null) || a[1].dex - b[1].dex);
    const mv = Object.entries(FLAGS.moves).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const out = [];
    if (sp.length) {
      out.push(`## Species (${sp.length})`);
      for (const [id, f] of sp) {
        out.push(`- ${f.dex != null ? "#" + f.dex + " " : ""}${f.name} (${id})` +
                 (f.note ? ` — ${f.note}` : ""));
      }
    }
    if (mv.length) {
      if (out.length) out.push("");
      out.push(`## Moves (${mv.length})`);
      for (const [id, f] of mv) {
        out.push(`- ${f.name} (${id})` + (f.note ? ` — ${f.note}` : "") +
                 (f.on ? `  [seen on ${f.on}]` : ""));
      }
    }
    return out.length ? out.join("\n") : "Nothing flagged yet.";
  }

  function flagsPanel() {
    const back = el("div", "sheetback");
    const sh = el("div", "sheet");
    back.appendChild(sh);
    const close = () => back.remove();
    back.addEventListener("click", e => { if (e.target === back) close(); });

    const head = el("div", "sheethead");
    head.appendChild(el("h2", null, `Flagged (${flagCount()})`));
    const x = el("button", "ghost sm", "Close");
    x.addEventListener("click", close);
    head.appendChild(x);
    sh.appendChild(head);

    const body = el("div", "sheetbody");
    sh.appendChild(body);

    const draw = () => {
      body.innerHTML = "";
      const groups = [["species", "Species"], ["moves", "Moves"]];
      let any = false;
      for (const [k, label] of groups) {
        const ids = Object.keys(FLAGS[k]);
        if (!ids.length) continue;
        any = true;
        body.appendChild(el("h3", null, `${label} (${ids.length})`));
        const ul = el("ul", "flaglist");
        ids.sort((a, b) => k === "species"
          ? (FLAGS[k][a].dex == null) - (FLAGS[k][b].dex == null) || FLAGS[k][a].dex - FLAGS[k][b].dex
          : FLAGS[k][a].name.localeCompare(FLAGS[k][b].name));
        for (const id of ids) {
          const f = FLAGS[k][id];
          const li = document.createElement("li");
          const a = el("a", "flagname", (k === "species" && f.dex != null ? "#" + f.dex + " " : "") + f.name);
          if (k === "species") a.href = "#/p/" + encodeURIComponent(id);
          else if (f.onId) a.href = "#/p/" + encodeURIComponent(f.onId);
          a.addEventListener("click", close);
          li.appendChild(a);
          const inp = document.createElement("input");
          inp.type = "text"; inp.placeholder = "note"; inp.value = f.note || "";
          inp.addEventListener("input", () => { f.note = inp.value.trim(); flagsSave(); });
          li.appendChild(inp);
          const del = el("button", "ghost sm", "✕");
          del.title = "Unflag";
          del.addEventListener("click", () => { delete FLAGS[k][id]; flagsSave(); draw(); refreshFlagUI(); });
          li.appendChild(del);
          ul.appendChild(li);
        }
        body.appendChild(ul);
      }
      if (!any) {
        body.appendChild(el("p", "muted2",
          "Nothing flagged yet. Use the ⚑ next to a species name, or the ⚑ on a move row."));
      }
    };
    draw();

    const foot = el("div", "sheetfoot");
    const copy = el("button", "ghost", "Copy all");
    copy.addEventListener("click", async () => {
      const txt = flagsText();
      try {
        await navigator.clipboard.writeText(txt);
        copy.textContent = "Copied";
      } catch (e) {
        // clipboard is blocked outside https — fall back to something selectable
        const ta = document.createElement("textarea");
        ta.value = txt; ta.className = "dump";
        body.appendChild(ta); ta.select();
        copy.textContent = "Select and copy ↓";
      }
      setTimeout(() => { copy.textContent = "Copy all"; }, 2200);
    });
    foot.appendChild(copy);
    const wipe = el("button", "ghost", "Clear all");
    wipe.addEventListener("click", () => {
      if (wipe.dataset.sure !== "1") { wipe.dataset.sure = "1"; wipe.textContent = "Really clear?"; return; }
      FLAGS.species = {}; FLAGS.moves = {}; flagsSave(); draw(); refreshFlagUI();
      wipe.dataset.sure = ""; wipe.textContent = "Clear all";
    });
    foot.appendChild(wipe);
    sh.appendChild(foot);
    document.body.appendChild(back);
  }

  // the detail page owns two bits of flag UI; let the panel poke them after a delete
  let refreshFlagUI = () => {};

  function mountFlagButton() {
    const b = el("button", "ghost flagbtn");
    b.id = "flagbtn";
    b.title = "Flagged for fixing (F)";
    b.appendChild(el("span", null, "⚑"));
    b.appendChild(el("i", null, ""));
    b.addEventListener("click", flagsPanel);
    const host = document.querySelector(".top-in");
    host.insertBefore(b, $("#theme"));
    flagsPaintCount();
  }

  /* ---------------------------------------------------------- routing */
  function route() {
    const h = location.hash || "#/";
    if (viewer) { viewer.destroy(); viewer = null; }
    const m = h.match(/^#\/p\/(.+)$/);
    if (m) { markTab("dex"); renderDetail(decodeURIComponent(m[1])); return; }
    if (h.startsWith("#/team")) {
      markTab("team");
      document.title = "Team Builder";
      if (window.TeamBuilder) window.TeamBuilder.render($("#view"));
      else $("#view").textContent = "Team builder failed to load.";
      return;
    }
    markTab("dex");
    document.title = "Pokédex";
    renderList();
  }

  function markTab(which) {
    document.querySelectorAll(".toptabs button").forEach(b =>
      b.classList.toggle("on", b.dataset.t === which));
    // the search box belongs to the dex; it means nothing on the builder
    const sw = document.querySelector(".searchwrap");
    if (sw) sw.hidden = which !== "dex";
  }

  // everything the team builder needs from here, so it can live in its own file rather
  // than making this one longer still
  window.DEX = { DB, el, $, chip, typeColor, cap, dj, STATS, TYPE, TYPE_ORDER, BUILD };
  window.addEventListener("hashchange", route);

  /* search + shortcuts */
  document.addEventListener("input", e => {
    if (e.target.id !== "q") return;
    F.q = e.target.value.trim(); F.shown = 0;
    if (location.hash.startsWith("#/p/")) { location.hash = "#/"; return; }
    const keep = e.target.value;
    renderList();
    const q = $("#q"); q.value = keep; q.focus();
    q.setSelectionRange(keep.length, keep.length);
  });
  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" ||
                 a.isContentEditable);
  };
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
    if (e.key === "Escape") {
      if (document.activeElement === $("#q")) $("#q").blur();
      const sb = document.querySelector(".sheetback");
      if (sb) sb.remove();
      return;
    }
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    // walking the dex: the arrows are the whole point of the pager
    if (e.key === "ArrowLeft") { step(-1); return; }
    if (e.key === "ArrowRight") { step(1); return; }
    if (e.key === "f" || e.key === "F") {
      const t = document.querySelector(".flagtoggle");
      if (t) { t.click(); e.preventDefault(); }
      else flagsPanel();
    }
  });
  $("#theme").addEventListener("click", () => {
    const r = document.documentElement;
    const cur = r.getAttribute("data-theme");
    const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.setAttribute("data-theme", dark ? "light" : "dark");
    try { localStorage.setItem("dex-theme", dark ? "light" : "dark"); } catch (e) {}
  });
  try {
    const saved = localStorage.getItem("dex-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}

  boot().catch(err => {
    $("#view").innerHTML = "";
    $("#view").appendChild(el("div", "empty",
      "Couldn't load the data files. If you opened index.html directly, serve the folder instead — " +
      "browsers block fetch() on file:// URLs."));
  });
})();
