(function () {
  "use strict";

  // Stamped by tools/wiki_data.py on every build. Every data file is fetched with it, so
  // a rebuilt Pokedex never shows through a browser's cached copy of the old one — which
  // is exactly what hid the Mega Showdown forms after they were added.
  const BUILD = "20260911194638";
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
    DB.moves = moves; DB.abilities = abil;
    // optional extras — the site works without either
    DB.models = await dj("data/models.json").catch(() => ({}));
    const loc = await dj("data/locations.json").catch(() => null);
    DB.locations = (loc && loc.locations) || {};
    $("#brandsub").textContent =
      `${DB.counts.total} species · ${DB.counts.megas} Megas · ${DB.counts.forms} extra forms`;
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
    const back = el("a", "back", "← All species");
    back.href = "#/";
    wrap.appendChild(back);

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
    tools.appendChild(bSpin); tools.appendChild(bReset);
    vbox.appendChild(tools);
    hero.appendChild(vbox);

    /* ---- identity ---- */
    const idt = el("div", "idt");
    hero.appendChild(idt);
    const h1 = el("h1", null, d.name);
    idt.appendChild(h1);
    idt.appendChild(el("div", "sub",
      (d.dex != null ? "#" + String(d.dex).padStart(4, "0") : "unnumbered") +
      (d.vanilla ? " · official" : " · custom")));
    const tRow = el("div", "types");
    idt.appendChild(tRow);
    const flav = el("p", "flavour");
    idt.appendChild(flav);

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
        (cur === "level" ? ["Lv", "Move", "Type", "Cat", "Pwr", "Acc", "PP", "Effect"]
                         : ["Move", "Type", "Cat", "Pwr", "Acc", "PP", "Effect"])
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
      viewer.load(pick.model, pick.texture, pick.pose, pick.layers)
        .then(() => { note.style.display = "none"; })
        .catch(err => { note.textContent = "Couldn't render this model."; note.style.display = "flex"; });
    }
    bSpin.addEventListener("click", () => { bSpin.textContent = viewer && viewer.toggleSpin() ? "Pause" : "Spin"; });
    bReset.addEventListener("click", () => viewer && viewer.reset());

    paintForm();
    window.scrollTo(0, 0);
  }

  function nameOf(id) { return (DB.byId[id] && DB.byId[id].n) || cap(id); }

  /* ---------------------------------------------------------- routing */
  function route() {
    const h = location.hash || "#/";
    if (viewer) { viewer.destroy(); viewer = null; }
    const m = h.match(/^#\/p\/(.+)$/);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else { document.title = "Pokédex"; renderList(); }
  }
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
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
    if (e.key === "Escape" && document.activeElement === $("#q")) $("#q").blur();
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
