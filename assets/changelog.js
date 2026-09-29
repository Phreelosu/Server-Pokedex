/* Changelog — #/changes (claude/64).
 *
 * What Cobblemon Oblivion changed compared with installing the addon packs yourself:
 * highlights, the server-wide rules by topic, then every pack with what it brings (generated
 * from the build) and what was changed about it (hand-kept in tools/data/changelog_notes.json).
 * Data: data/changelog.json, written by tools/build_changelog.py.
 * #/changes/<pack> opens that pack's entry.
 */
(function () {
  "use strict";
  const D = () => window.DEX;
  const KIND = { added: "Added", changed: "Changed", fixed: "Fixed", cut: "Removed", note: "Note" };
  const CAP = 48;                       // chips shown before "show all"
  let DATA = null;
  const UI = { q: "", f: "all", open: new Set() };

  const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

  function el(t, c, x) { return D().el(t, c, x); }

  function kindTag(k) {
    const s = el("span", "cl-k cl-k-" + k, KIND[k] || k);
    return s;
  }

  function spLink(id, text) {
    const a = el("a", "cl-sp", text);
    a.href = "#/p/" + encodeURIComponent(id);
    return a;
  }

  function item(it) {
    const li = el("li", "cl-item");
    li.appendChild(kindTag(it.k));
    const body = el("div", "cl-t");
    // link each Pokémon where the text names it; any it doesn't name become chips below
    const text = it.t, hits = [], rest = [];
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    (it.sp || []).slice().sort((a, b) => b[1].length - a[1].length).forEach(([id, n]) => {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, "u");
      let m = null, from = 0;
      while (from <= text.length) {
        const mm = re.exec(text.slice(from));
        if (!mm) break;
        const at = from + mm.index;
        if (!hits.some(h => at < h.e && at + n.length > h.s)) { m = at; break; }
        from = at + 1;
      }
      if (m == null) rest.push([id, n]); else hits.push({ s: m, e: m + n.length, id });
    });
    hits.sort((a, b) => a.s - b.s);
    let at = 0;
    const line = el("span");
    hits.forEach(h => {
      if (h.s > at) line.appendChild(document.createTextNode(text.slice(at, h.s)));
      line.appendChild(spLink(h.id, text.slice(h.s, h.e))).classList.add("cl-in");
      at = h.e;
    });
    line.appendChild(document.createTextNode(text.slice(at)));
    body.appendChild(line);
    if (rest.length) {
      const sp = el("span", "cl-sps");
      rest.forEach(([id, n]) => sp.appendChild(spLink(id, n)));
      body.appendChild(sp);
    }
    li.appendChild(body);
    return li;
  }

  function chipList(title, rows, make) {
    const box = el("div", "cl-block");
    box.appendChild(el("h4", null, `${title} · ${rows.length}`));
    const wrap = el("div", "cl-chips");
    const paint = all => {
      wrap.textContent = "";
      (all ? rows : rows.slice(0, CAP)).forEach(r => wrap.appendChild(make(r)));
      if (!all && rows.length > CAP) {
        const b = el("button", "cl-more", `Show all ${rows.length}`);
        b.onclick = () => paint(true);
        wrap.appendChild(b);
      }
    };
    paint(false);
    box.appendChild(wrap);
    return box;
  }

  function summaryBits(p) {
    const b = [];
    if (p.species.length) b.push(`${p.species.length} Pokémon`);
    if (p.megas.length) b.push(`${p.megas.length} Mega${p.megas.length > 1 ? "s" : ""}`);
    if (p.forms.length) b.push(`${p.forms.length} form${p.forms.length > 1 ? "s" : ""}`);
    if (p.remodels.length) b.push(`${p.remodels.length} restyle${p.remodels.length > 1 ? "s" : ""}`);
    if (p.notes.length) b.push(`${p.notes.length} change${p.notes.length > 1 ? "s" : ""}`);
    return b;
  }

  function packCard(p) {
    const det = el("details", "cl-pack");
    det.id = "pack-" + slug(p.name);
    det.open = UI.open.has(p.name);
    det.addEventListener("toggle", () => { det.open ? UI.open.add(p.name) : UI.open.delete(p.name); });
    const sum = el("summary");
    const h = el("span", "cl-pname", p.name);
    sum.appendChild(h);
    if (p.version) sum.appendChild(el("span", "cl-ver", "v" + p.version));
    const bits = summaryBits(p);
    sum.appendChild(el("span", "cl-pmeta", bits.length ? bits.join(" · ") : "included as is"));
    det.appendChild(sum);

    const body = el("div", "cl-pbody");
    if (p.notes.length) {
      const ul = el("ul", "cl-items");
      const order = { added: 0, changed: 1, fixed: 2, cut: 3, note: 4 };
      p.notes.slice().sort((a, b) => order[a.k] - order[b.k]).forEach(it => ul.appendChild(item(it)));
      body.appendChild(ul);
    }
    if (p.species.length) body.appendChild(chipList("New Pokémon", p.species, ([id, n]) => spLink(id, n)));
    if (p.megas.length) body.appendChild(chipList("Megas", p.megas, ([id, n, f]) =>
      spLink(id, /mega/i.test(f) && f.toLowerCase().includes(n.toLowerCase()) ? f : `${n} · ${f}`)));
    if (p.forms.length) body.appendChild(chipList("Forms added to other Pokémon", p.forms, ([id, n, f]) =>
      spLink(id, `${n} · ${f}`)));
    if (p.remodels.length) body.appendChild(chipList("Official Pokémon it restyles", p.remodels,
      ([id, n]) => spLink(id, n)));
    if (p.hidden.length) {
      const box = el("div", "cl-block");
      box.appendChild(el("h4", null, `Hidden (no model of their own) · ${p.hidden.length}`));
      box.appendChild(el("p", "cl-hid", p.hidden.join(", ")));
      body.appendChild(box);
    }
    if (!body.childNodes.length) body.appendChild(el("p", "cl-hid", "Included as it comes; nothing needed changing."));
    det.appendChild(body);
    return det;
  }

  function matches(p) {
    const f = UI.f;
    if (f === "species" && !p.species.length) return false;
    if (f === "megas" && !p.megas.length) return false;
    if (f === "forms" && !(p.forms.length || p.remodels.length)) return false;
    if (f === "changed" && !p.notes.length) return false;
    if (!UI.q) return true;
    const q = UI.q.toLowerCase();
    if (p.name.toLowerCase().includes(q)) return true;
    const hit = a => a.some(r => r.some(v => String(v).toLowerCase().includes(q)));
    return hit(p.species) || hit(p.megas) || hit(p.forms) || hit(p.remodels) ||
      p.notes.some(n => n.t.toLowerCase().includes(q)) || p.hidden.some(h => h.toLowerCase().includes(q));
  }

  function renderPacks(host) {
    host.textContent = "";
    const list = DATA.packs.filter(matches);
    const n = el("p", "cl-count", `${list.length} of ${DATA.packs.length} packs`);
    host.appendChild(n);
    list.forEach(p => {
      const card = packCard(p);
      if (UI.q && !UI.open.has(p.name)) card.open = list.length <= 3;
      host.appendChild(card);
    });
    if (!list.length) host.appendChild(el("p", "cl-hid", "No pack matches that search."));
  }

  function render(view, target) {
    view.textContent = "";
    const w = el("div", "wrap cl");
    const s = DATA.stats;

    const hero = el("section", "cl-hero");
    hero.appendChild(el("p", "cl-eyebrow", "Cobblemon Oblivion"));
    hero.appendChild(el("h1", null, "What's different on this server"));
    hero.appendChild(el("p", "cl-intro", DATA.intro));
    const strip = el("div", "cl-stats");
    [[s.species, "Pokémon"], [s.megas, "Megas"], [s.packs, "addon packs"], [s.tms, "TMs"],
     [s.zones, "routes"]].forEach(([v, l]) => {
      const c = el("div", "cl-stat");
      c.appendChild(el("b", null, Number(v).toLocaleString("en-US")));
      c.appendChild(el("span", null, l));
      strip.appendChild(c);
    });
    hero.appendChild(strip);
    const jump = el("nav", "cl-jump");
    [["Highlights", "cl-high"], ["Server rules", "cl-rules"], ["Pack by pack", "cl-packs"],
     ["Not included", "cl-rejected"], ["Known issues", "cl-known"]].forEach(([t, id]) => {
      const a = el("button", null, t);
      a.type = "button";
      a.onclick = () => document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" });
      jump.appendChild(a);
    });
    hero.appendChild(jump);
    w.appendChild(hero);

    const high = el("section", "cl-sec");
    high.id = "cl-high";
    high.appendChild(el("h2", null, "Highlights"));
    const hg = el("div", "cl-high");
    DATA.highlights.forEach(h => {
      const c = el("div", "cl-hcard");
      c.appendChild(el("h3", null, h.t));
      c.appendChild(el("p", null, h.d));
      hg.appendChild(c);
    });
    high.appendChild(hg);
    w.appendChild(high);

    const rules = el("section", "cl-sec");
    rules.id = "cl-rules";
    rules.appendChild(el("h2", null, "Server-wide changes"));
    rules.appendChild(el("p", "cl-sub", "Rules and fixes that apply to every pack."));
    const rg = el("div", "cl-rules");
    DATA.sections.forEach(sec => {
      const c = el("div", "cl-panel");
      c.id = "rule-" + sec.id;
      c.appendChild(el("h3", null, sec.title));
      const ul = el("ul", "cl-items");
      sec.items.forEach(it => ul.appendChild(item(it)));
      c.appendChild(ul);
      rg.appendChild(c);
    });
    rules.appendChild(rg);
    w.appendChild(rules);

    const packs = el("section", "cl-sec");
    packs.id = "cl-packs";
    packs.appendChild(el("h2", null, "Pack by pack"));
    packs.appendChild(el("p", "cl-sub",
      "Every addon on the server: the Pokémon, Megas and forms it brings, and anything that was changed about it. " +
      "Click a pack to open it; click a Pokémon to see its page."));
    const bar = el("div", "cl-bar");
    const q = el("input", "cl-q");
    q.type = "search"; q.placeholder = "Search packs, Pokémon or changes…"; q.value = UI.q;
    const listHost = el("div", "cl-list");
    q.addEventListener("input", () => { UI.q = q.value.trim(); renderPacks(listHost); });
    bar.appendChild(q);
    const seg = el("div", "seg");
    [["all", "All"], ["species", "Adds Pokémon"], ["megas", "Adds Megas"], ["forms", "Forms & looks"],
     ["changed", "Has changes"]].forEach(([v, t]) => {
      const b = el("button", UI.f === v ? "on" : "", t);
      b.onclick = () => { UI.f = v; seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderPacks(listHost); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    const tog = el("button", "ghost sm", "Open all");
    tog.onclick = () => {
      const all = [...listHost.querySelectorAll("details")];
      const open = !all.every(d => d.open);
      all.forEach(d => { d.open = open; });
      tog.textContent = open ? "Close all" : "Open all";
    };
    bar.appendChild(tog);
    packs.appendChild(bar);
    packs.appendChild(listHost);
    w.appendChild(packs);
    renderPacks(listHost);

    const rej = el("section", "cl-sec");
    rej.id = "cl-rejected";
    rej.appendChild(el("h2", null, "Not included"));
    rej.appendChild(el("p", "cl-sub", "Packs that were looked at and left out, and why."));
    const rl = el("div", "cl-rules cl-rej");
    DATA.rejected.forEach(r => {
      const c = el("div", "cl-panel");
      c.appendChild(el("h3", null, r.name));
      const ul = el("ul", "cl-items");
      r.notes.forEach(it => ul.appendChild(item(it)));
      c.appendChild(ul);
      rl.appendChild(c);
    });
    rej.appendChild(rl);
    w.appendChild(rej);

    const kn = el("section", "cl-sec");
    kn.id = "cl-known";
    kn.appendChild(el("h2", null, "Known issues"));
    const ul = el("ul", "cl-known");
    DATA.known.forEach(k => ul.appendChild(el("li", null, k)));
    kn.appendChild(ul);
    w.appendChild(kn);
    w.appendChild(el("p", "cl-built", `Generated from the server's build on ${DATA.built}.`));

    view.appendChild(w);

    if (target) {
      const p = DATA.packs.find(x => slug(x.name) === target);
      const node = document.getElementById("pack-" + target);
      if (p && node) {
        node.open = true; UI.open.add(p.name);
        setTimeout(() => node.scrollIntoView({ block: "start" }), 0);
      }
    } else window.scrollTo(0, 0);
  }

  async function show(view, target) {
    if (!DATA) {
      view.textContent = "";
      view.appendChild(el("p", "wrap", "Loading the changelog…"));
      try { DATA = await D().dj("data/changelog.json"); }
      catch (e) { view.textContent = ""; view.appendChild(el("p", "wrap", "The changelog isn't built yet.")); return; }
    }
    render(view, target);
  }

  window.Changelog = { render: show, slug };
})();
