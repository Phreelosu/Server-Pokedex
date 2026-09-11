# Putting the Pokédex online

It is a folder of static files — no server, no database, no build step. Anything that can
serve a folder will host it, free, forever.

**Numbers that decide the choice:** 18,316 files, 158 MB. First page load is about 850 KB
over the wire (`models.json` is 13 MB on disk but 0.7 MB gzipped, and every host below
gzips automatically). Every path in the site is relative, so it works in a subfolder.

---

## GitHub Pages — the recommendation

Free, no card, no sleep, custom domain if you want one later. 158 MB sits well inside the
1 GB published-site limit, and there is no file-count limit.

**One thing to know first:** GitHub Pages is free only from a **public** repository —
private repos need GitHub Pro. So the models and textures from all 121 addon packs become
publicly downloadable. `CREDITS.md` lists every pack, which is the decent minimum; if any
author would rather not be redistributed, take their pack out of the merge and rebuild.

### Once

1. Install Git for Windows if you haven't: <https://git-scm.com/download/win>
2. Make an empty repo on GitHub — say `cobblemon-dex`. **No** README, **no** .gitignore.
3. Open a terminal in `E:\oldmarketmod\cobblemonmerger\CobblemonWiki` and run:

```bat
git init
git add .
git commit -m "Server Pokedex"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/cobblemon-dex.git
git push -u origin main
```

The push moves 158 MB across 18,316 files — give it a few minutes.

4. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)` →
   Save.**

A minute or two later it is live at:

```
https://YOUR-NAME.github.io/cobblemon-dex/
```

### Every time you change a pack

Rebuild here, then from the same folder:

```bat
git add -A
git commit -m "pack update"
git push
```

The site refreshes itself within a minute. The build id in `index.html` changes on every
rebuild, so nobody gets a stale copy.

---

## If you outgrow it

**Bandwidth.** GitHub Pages has a soft limit of 100 GB/month. A 5 MB average visit means
roughly 20,000 page views a month before anyone looks at it — far past a server's worth of
players. If you ever do hit it, **Cloudflare Pages** is free with unlimited bandwidth.

One catch worth knowing before you plan on it: Cloudflare Pages caps a deployment at
**20,000 files**, and this site is at 18,316. About 1,700 files of headroom — roughly ten
more addon packs. GitHub Pages has no such cap, which is the other reason it is the
recommendation.

**Netlify** also works (drag the folder onto <https://app.netlify.com/drop>, no account
needed to try) but its free tier is the same 100 GB as GitHub's, so it buys nothing.

---

## What not to do

- **Don't host it out of your Minecraft server box** unless you already run a web server
  there. It is static files; there is no reason to pay for uptime you are already getting
  free, and it is one more thing to keep patched.
- **Don't commit `models/` to Git LFS.** The files are tiny individually; LFS has a 1 GB
  free quota and would run out long before plain Git does.
- **Don't rename the folder to `docs/`** or move things around. Every path in
  `data/models.json` is relative to the site root.

---

## Checks already done

- No file over 25 MB (largest is `data/models.json` at 13 MB), so every host's per-file
  cap is clear.
- No two files in any folder differ only by capitalisation — that would work on your
  Windows machine and 404 on a Linux host, or silently lose a file when unzipped.
- All 15,935 model, texture and layer paths referenced in `models.json` exist on disk.
- Nothing loads from an absolute path or a CDN except Google Fonts.
- `.nojekyll` is present, so GitHub serves the folder as-is instead of running it through
  Jekyll.
- `.gitattributes` turns off line-ending conversion, so Git can't rewrite the JSON on a
  Windows checkout.
