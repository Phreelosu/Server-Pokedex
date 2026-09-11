#!/usr/bin/env python3
"""
Pull the 3D models and textures this wiki needs out of the packs you already have.

Run it once, from the wiki folder, pointing at wherever your files live:

    python build-assets.py --from "..\\merged" --from "..\\Cobblemon-neoforge-1.8.0+1.21.1.jar"

Each --from can be a .jar, a .zip, or a folder containing them. Cobblemon's own jar has
the 1025 official Pokemon; the resourcepack parts have everything the addons add.

Writes models/<species>/… and data/models.json, then the wiki has pictures.
Without this step the wiki still works — every page just shows a placeholder instead
of a model.
"""
import os, sys, json, re, zipfile, argparse, collections, io

# Windows hands us the system codepage (cp1250, cp1252, ...) for both files and the
# console. Every file this script touches is UTF-8, so say so rather than hoping.
for _s in (sys.stdout, sys.stderr):
    try:
        if (_s.encoding or "").lower().replace("-", "") != "utf8":
            _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_MODELS = os.path.join(HERE, "models")
NORM = lambda s: re.sub(r'[^a-z0-9]', '', (s or '').lower())


# --------------------------------------------------------------------------
# a uniform reader over folders, zips, and zips nested in jars
# --------------------------------------------------------------------------
class Source:
    def __init__(self):
        self.files = {}            # normalised asset path -> (kind, handle, member)
        self._zips = []

    def add(self, path):
        if os.path.isdir(path):
            archives = []
            for dp, dn, fns in os.walk(path):
                for fn in fns:
                    full = os.path.join(dp, fn)
                    if fn.lower().endswith((".zip", ".jar")):
                        # never read a previous build of this site back in as a source
                        if not fn.lower().startswith("cobblemonwiki"):
                            archives.append(full)
                        continue
                    rel = os.path.relpath(full, path).replace("\\", "/")
                    self._put(rel, ("fs", full, None))
            # pack zips and mod jars, at any depth — the merged mods live in a subfolder
            # and their models were being missed entirely
            for a in sorted(archives):
                self.add(a)
            return
        if not os.path.isfile(path):
            print(f"  ! not found: {path}")
            return
        try:
            z = zipfile.ZipFile(path)
        except Exception as e:
            print(f"  ! not a zip: {path} ({e})")
            return
        self._zips.append(z)
        for n in z.namelist():
            if n.endswith("/"):
                continue
            self._put(n, ("zip", z, n))

    def _put(self, rel, ref):
        i = rel.find("assets/")
        if i < 0:
            return
        self.files.setdefault(rel[i:], ref)

    def read(self, rel):
        ref = self.files.get(rel)
        if not ref:
            return None
        kind, h, m = ref
        if kind == "fs":
            with open(h, "rb") as f:
                return f.read()
        return h.read(m)


def jload(b):
    if b is None:
        return None
    t = b.decode("utf-8", "replace").lstrip("﻿")
    t = re.sub(r'^\s*//.*$', '', t, flags=re.M)
    t = re.sub(r',(\s*[}\]])', r'\1', t)
    try:
        return json.loads(t)
    except Exception:
        return None



# ---------------------------------------------------------------------------
# A small Molang evaluator.
#
# Cobblemon poses its models with Bedrock animations whose bone channels are Molang
# expressions, and the POSE IS THE CONSTANT IN THEM. Charizard's neck is
# "22.5+math.sin(q.anim_time*90*1-135)*2.5" — 22.5 degrees of neck, plus a small breathing
# wobble. Treating the whole expression as zero, which this script used to do, threw away
# the 22.5 and kept the wobble's starting value, which is why so many models stood in the
# flat pose their geometry was authored in.
#
# Evaluating at anim_time = 0 gives the real rest pose. The subset below covers what
# Cobblemon actually uses; anything unknown resolves to 0.0, which is the right default for
# a query about a Pokemon that is standing still and not being looked at.
# ---------------------------------------------------------------------------
import math as _math


class _Molang:
    """Recursive-descent parser for the Molang subset Cobblemon animations use."""

    FUNCS = {
        # Bedrock's trig works in DEGREES, unlike Python's
        "math.sin":   lambda a: _math.sin(_math.radians(a[0])),
        "math.cos":   lambda a: _math.cos(_math.radians(a[0])),
        "math.asin":  lambda a: _math.degrees(_math.asin(max(-1.0, min(1.0, a[0])))),
        "math.acos":  lambda a: _math.degrees(_math.acos(max(-1.0, min(1.0, a[0])))),
        "math.atan":  lambda a: _math.degrees(_math.atan(a[0])),
        "math.atan2": lambda a: _math.degrees(_math.atan2(a[0], a[1])),
        "math.abs":   lambda a: abs(a[0]),
        "math.sqrt":  lambda a: _math.sqrt(a[0]) if a[0] > 0 else 0.0,
        "math.exp":   lambda a: _math.exp(min(64.0, a[0])),
        "math.ln":    lambda a: _math.log(a[0]) if a[0] > 0 else 0.0,
        "math.pow":   lambda a: (a[0] ** a[1]) if (a[0] >= 0 or float(a[1]).is_integer()) else 0.0,
        "math.floor": lambda a: _math.floor(a[0]),
        "math.ceil":  lambda a: _math.ceil(a[0]),
        "math.round": lambda a: float(round(a[0])),
        "math.trunc": lambda a: float(int(a[0])),
        "math.sign":  lambda a: (a[0] > 0) - (a[0] < 0),
        "math.min":   lambda a: min(a),
        "math.max":   lambda a: max(a),
        "math.clamp": lambda a: max(a[1], min(a[2], a[0])),
        "math.mod":   lambda a: _math.fmod(a[0], a[1]) if a[1] else 0.0,
        "math.lerp":  lambda a: a[0] + (a[1] - a[0]) * a[2],
        "math.lerprotate": lambda a: a[0] + (a[1] - a[0]) * a[2],
        # deterministic: a still frame must not jitter between builds
        "math.random":          lambda a: (a[0] + a[1]) / 2 if len(a) >= 2 else 0.5,
        "math.random_integer":  lambda a: float(int((a[0] + a[1]) / 2)) if len(a) >= 2 else 0.0,
        "math.die_roll":        lambda a: (a[1] + a[2]) / 2 * a[0] if len(a) >= 3 else 0.0,
        "math.die_roll_integer": lambda a: float(int((a[1] + a[2]) / 2 * a[0])) if len(a) >= 3 else 0.0,
        "math.hermite_blend":   lambda a: a[0],
        "math.pi":              lambda a: _math.pi,
    }

    def __init__(self, vars_):
        self.v = vars_

    # ---- tokeniser -------------------------------------------------------
    import re as _re
    _TOK = _re.compile(r"""
        \s*(?:
          (?P<num>\d+\.\d+|\.\d+|\d+)
        | (?P<name>[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)
        | (?P<op><=|>=|==|!=|&&|\|\||\?\?|[-+*/()?:,;<>!])
        | (?P<str>'[^']*')
        )""", _re.X)

    def tokens(self, s):
        out, i = [], 0
        while i < len(s):
            m = self._TOK.match(s, i)
            if not m or m.end() == i:
                i += 1
                continue
            i = m.end()
            if m.group("num"):
                out.append(("n", float(m.group("num"))))
            elif m.group("name"):
                out.append(("id", m.group("name")))
            elif m.group("str"):
                out.append(("s", m.group("str")[1:-1]))
            else:
                out.append(("o", m.group("op")))
        return out

    # ---- parser ----------------------------------------------------------
    def eval(self, src):
        self.t = self.tokens(str(src))
        self.i = 0
        val = 0.0
        while self.i < len(self.t):
            if self.peek() == ("o", ";"):
                self.i += 1
                continue
            if self.t[self.i] == ("id", "return"):
                self.i += 1
            val = self.ternary()
            if self.i < len(self.t) and self.peek() == ("o", ";"):
                self.i += 1
            elif self.i < len(self.t):
                break            # unparseable tail: keep what we have
        return val

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def accept(self, op):
        if self.peek() == ("o", op):
            self.i += 1
            return True
        return False

    def ternary(self):
        c = self.logic()
        if self.accept("?"):
            a = self.ternary()
            b = self.ternary() if self.accept(":") else 0.0
            return a if c else b
        if self.accept("??"):
            b = self.ternary()
            return c if c else b
        return c

    def logic(self):
        v = self.compare()
        while True:
            if self.accept("&&"):
                v = 1.0 if (v and self.compare()) else 0.0
            elif self.accept("||"):
                r = self.compare()
                v = 1.0 if (v or r) else 0.0
            else:
                return v

    def compare(self):
        v = self.add()
        for op, fn in (("<=", lambda a, b: a <= b), (">=", lambda a, b: a >= b),
                       ("==", lambda a, b: a == b), ("!=", lambda a, b: a != b),
                       ("<", lambda a, b: a < b), (">", lambda a, b: a > b)):
            if self.accept(op):
                return 1.0 if fn(v, self.add()) else 0.0
        return v

    def add(self):
        v = self.mul()
        while True:
            if self.accept("+"):
                v += self.mul()
            elif self.accept("-"):
                v -= self.mul()
            else:
                return v

    def mul(self):
        v = self.unary()
        while True:
            if self.accept("*"):
                v *= self.unary()
            elif self.accept("/"):
                d = self.unary()
                v = v / d if d else 0.0
            else:
                return v

    def unary(self):
        if self.accept("-"):
            return -self.unary()
        if self.accept("+"):
            return self.unary()
        if self.accept("!"):
            return 0.0 if self.unary() else 1.0
        return self.atom()

    def atom(self):
        k, val = self.peek()
        if k == "n":
            self.i += 1
            return val
        if k == "s":
            self.i += 1
            return 0.0
        if k == "o" and val == "(":
            self.i += 1
            v = self.ternary()
            self.accept(")")
            return v
        if k == "id":
            self.i += 1
            name = val
            args = []
            if self.accept("("):
                if not self.accept(")"):
                    while True:
                        args.append(self.ternary())
                        if self.accept(","):
                            continue
                        self.accept(")")
                        break
            return self.resolve(name, args)
        self.i += 1
        return 0.0

    def resolve(self, name, args):
        low = name.lower()
        # query.x and q.x are the same namespace, likewise variable./v. and temp./t.
        for a, b in (("query.", "q."), ("variable.", "v."), ("temp.", "t.")):
            if low.startswith(a):
                low = b + low[len(a):]
        fn = self.FUNCS.get(low)
        if fn:
            try:
                return float(fn(args or [0.0]))
            except Exception:
                return 0.0
        if low in ("math.pi",):
            return _math.pi
        return float(self.v.get(low, 0.0))


# A Pokemon standing still, at the first frame, not moving and not being looked at.
MOLANG_VARS = {
    "q.anim_time": 0.0, "q.life_time": 0.0, "q.modified_distance_moved": 0.0,
    "q.ground_speed": 0.0, "q.vertical_speed": 0.0, "q.modified_move_speed": 0.0,
    "q.is_moving": 0.0, "q.is_in_water": 0.0, "q.is_on_ground": 1.0,
    "q.is_sleeping": 0.0, "q.is_holding_item": 0.0, "q.is_battle": 0.0,
    "q.head_x_rotation": 0.0, "q.head_y_rotation": 0.0,
    "q.body_x_rotation": 0.0, "q.body_y_rotation": 0.0,
    "q.time_of_day": 0.5, "q.health": 1.0, "q.max_health": 1.0,
    "q.hurt_time": 0.0, "q.swell_amount": 0.0, "q.scale": 1.0,
}


def molang(expr, extra=None):
    """Evaluate a Molang expression to a float. Anything unknown resolves to 0."""
    if isinstance(expr, (int, float)):
        return float(expr)
    v = dict(MOLANG_VARS)
    if extra:
        v.update(extra)
    try:
        return float(_Molang(v).eval(expr))
    except Exception:
        return 0.0


def first_frame(tex):
    """A resolver's "texture" is usually a path, but an animated one is an object:
    {"frames": [...], "fps": 8, "loop": true}. Charcadet, Armarouge, Ceruledge and about
    sixty others are drawn that way, and treating the object as a path silently lost
    them. The wiki shows a still, so take the first frame."""
    if isinstance(tex, dict):
        fr = tex.get("frames")
        if isinstance(fr, list) and fr:
            return fr[0]
        return None
    return tex


def res_path(loc, folder, ext):
    """'cobblemon:charizard_mega.geo' -> assets/cobblemon/bedrock/pokemon/models/... (searched)"""
    loc = str(loc or "")
    ns, _, rest = loc.partition(":")
    if not rest:
        ns, rest = "cobblemon", loc
    return ns, rest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="srcs", action="append", required=True,
                    help="a folder, .zip or .jar to read models and textures from (repeatable)")
    ap.add_argument("--limit", type=int, default=0, help="only do the first N species (for a quick test)")
    args = ap.parse_args()

    src = Source()
    for s in args.srcs:
        print(f"reading {s}")
        src.add(s)
    print(f"  {len(src.files)} asset files visible\n")

    # ---- index every geometry by its identifier --------------------------
    geo_by_id, geo_by_file = {}, {}
    for rel in src.files:
        if not rel.endswith(".geo.json"):
            continue
        d = jload(src.read(rel))
        if not d:
            continue
        for g in (d.get("minecraft:geometry") or []):
            ident = (g.get("description") or {}).get("identifier")
            if ident:
                geo_by_id.setdefault(str(ident), rel)
        geo_by_file.setdefault(os.path.basename(rel)[:-9].lower(), rel)
    print(f"geometries indexed: {len(geo_by_id)}")

    # ---- posers and animations -------------------------------------------
    # Cobblemon authors its geometry in a splayed rest pose and lets the poser put the
    # limbs where they belong. The poser names a Bedrock idle animation, whose bone
    # channels are Molang expressions — and the pose lives in those expressions, as the
    # constant term: Charizard's wing is "-55+math.sin(q.anim_time*90*0.7-60)*8", which is
    # 55 degrees of wing plus a little flap. Evaluating each channel at anim_time = 0
    # gives the animation's first frame, which is the pose the model actually stands in.
    anims = {}
    for rel in src.files:
        if not rel.endswith(".animation.json"):
            continue
        d = jload(src.read(rel))
        for name, body in ((d or {}).get("animations") or {}).items():
            anims.setdefault(str(name), body)
    posers = {}
    for rel in src.files:
        # packs use either bedrock/pokemon/posers/ or the older bedrock/posers/
        if "/posers/" not in rel or "/bedrock/" not in rel or not rel.endswith(".json"):
            continue
        d = jload(src.read(rel))
        if isinstance(d, dict) and ("poses" in d or "portraitScale" in d):
            posers[os.path.basename(rel)[:-5].lower()] = d
    print(f"posers: {len(posers)}   animations: {len(anims)}")

    ANIM_RE = re.compile(r"bedrock\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]")

    def num(v):
        """A channel component: a number, or Molang whose constant term IS the pose."""
        if isinstance(v, (int, float)):
            return float(v)
        return molang(v)

    def at_zero(v):
        """a bone channel -> [x,y,z] at anim_time 0, Molang and all"""
        if isinstance(v, list):
            return [num(x) for x in v[:3]] + [0.0] * max(0, 3 - len(v))
        if isinstance(v, dict):
            keys = []
            for k in v:
                try:
                    keys.append((float(k), k))
                except Exception:
                    pass
            if not keys:
                return None
            f = v[min(keys)[1]]
            if isinstance(f, dict):
                f = f.get("vector") or f.get("post") or f.get("pre")
            return at_zero(f) if f is not None else None
        return None

    # in preference order; a battle, faint or sleep animation is not how it stands
    IDLE_RANK = ("ground_idle", "air_idle", "idle", "surfacewater_idle", "water_idle",
                 "ground_walk", "air_fly")

    def idle_for(stem):
        """The best idle animation a model has, for the species whose poser is not JSON.

        Cobblemon writes the posers for a good part of the older dex in Kotlin instead —
        Vivillon is one, which is why its wings hung folded and edge-on. The animation
        file is still shipped, so when there is no poser to read, read the animation
        directly."""
        pre = f"animation.{stem}."
        mine = [k for k in anims if k.lower().startswith(pre)]
        if not mine:
            return None
        def rank(k):
            tail = k[len(pre):].lower()
            for i, want in enumerate(IDLE_RANK):
                if tail == want:
                    return i
            return len(IDLE_RANK) + (0 if "idle" in tail else 1)
        best = min(mine, key=rank)
        tail = best[len(pre):].lower()
        if "idle" not in tail and "walk" not in tail and "fly" not in tail:
            return None
        return {"animations": [f"q.bedrock('{stem}', '{best[len(pre):]}')"]}

    def pose_for(model_id):
        """the still pose for a model, as {bone: {rot:[x,y,z], pos:[x,y,z]}}"""
        stem = str(model_id).split(":")[-1].replace(".geo", "").lower()
        pos = posers.get(stem)
        if not pos:
            pos = next((v for k, v in posers.items() if k in stem or stem in k), None)
        if not pos:
            fallback = idle_for(stem)
            if not fallback:
                return None, None
            return pose_from(fallback), None
        chosen = None
        for name, body in (pos.get("poses") or {}).items():
            types = [str(t).upper() for t in (body.get("poseTypes") or [])]
            if "PROFILE" in types or "PORTRAIT" in types or "STAND" in types or "NONE" in types:
                # a swimming pose is a STAND too; it is not how the thing stands on land
                if body.get("isBattle") or body.get("isTouchingWater") or body.get("isUnderWater"):
                    continue
                chosen = body
                if "PROFILE" in types or "PORTRAIT" in types:
                    break
        if chosen is None:
            chosen = next(iter((pos.get("poses") or {}).values()), None)
        out = pose_from(chosen)
        if out is None:
            # a poser that names no animation we have; its own idle still might
            out = pose_from(idle_for(stem) or {})
        return out, pos

    def pose_from(chosen):
        """one pose body -> {bone: {rot, pos}}, every channel read at anim_time 0"""
        out = {}
        for expr in ((chosen or {}).get("animations") or []):
            m = ANIM_RE.search(str(expr))
            if not m:
                continue
            key = f"animation.{m.group(1)}.{m.group(2)}"
            body = anims.get(key)
            if not body:
                body = next((v for k, v in anims.items() if k.endswith("." + m.group(2))
                             and m.group(1) in k), None)
            for bone, ch in ((body or {}).get("bones") or {}).items():
                if not isinstance(ch, dict):
                    continue
                r = at_zero(ch.get("rotation")) if "rotation" in ch else None
                t = at_zero(ch.get("position")) if "position" in ch else None
                if r or t:
                    e = out.setdefault(str(bone), {})
                    if r and any(r): e["rot"] = [round(x, 3) for x in r]
                    if t and any(t): e["pos"] = [round(x, 3) for x in t]
        # A pose can also nail a part down itself, outside any animation — Empoleon's
        # left arm is 52.5 degrees of shoulder that exists nowhere else. These stack on
        # top of whatever the animation said.
        for tp in ((chosen or {}).get("transformedParts") or []):
            if not isinstance(tp, dict) or not tp.get("part"):
                continue
            e = out.setdefault(str(tp["part"]), {})
            for src_key, dst in (("rotation", "rot"), ("position", "pos")):
                v = at_zero(tp.get(src_key)) if src_key in tp else None
                if not v or not any(v):
                    continue
                have = e.get(dst) or [0.0, 0.0, 0.0]
                e[dst] = [round(have[i] + v[i], 3) for i in range(3)]
        out = {b: e for b, e in out.items() if e}   # a bone that ended up at zero is no pose
        return out or None

    # ---- every resolver, grouped by species -------------------------------
    resolvers = collections.defaultdict(list)
    for rel in src.files:
        # resolvers live at bedrock/pokemon/resolvers/ in newer packs and bedrock/species/
        # in older ones; identify them by shape rather than by folder
        if "/bedrock/" not in rel or not rel.endswith(".json"):
            continue
        if not ("/resolvers/" in rel or "/species/" in rel):
            continue
        d = jload(src.read(rel))
        if not isinstance(d, dict):
            continue
        sp = d.get("species")
        if not sp or not isinstance(d.get("variations"), list):
            continue
        resolvers[NORM(str(sp).split(":")[-1])].append(d)
    print(f"species with a resolver: {len(resolvers)}")

    # ---- which species does the wiki actually have? -----------------------
    index_path = os.path.join(HERE, "data", "index.json")
    if not os.path.exists(index_path):
        print(f"\n! {index_path} is missing — run this from inside the wiki folder.")
        return
    with open(index_path, encoding="utf-8") as fh:
        idx = json.load(fh)
    wanted = [r["id"] for r in idx["species"]]
    if args.limit:
        wanted = wanted[:args.limit]

    os.makedirs(OUT_MODELS, exist_ok=True)
    manifest = {}
    copied, missing_model, missing_tex = 0, 0, 0
    seen_files = {}

    def stash(rel, sid):
        """copy an asset into models/<sid>/ and return the wiki-relative path"""
        nonlocal copied
        if rel in seen_files:
            return seen_files[rel]
        blob = src.read(rel)
        if blob is None:
            return None
        name = os.path.basename(rel)
        dest_dir = os.path.join(OUT_MODELS, sid)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, name)
        n = 1
        while os.path.exists(dest) and os.path.getsize(dest) != len(blob):
            stem, ext = os.path.splitext(name)
            dest = os.path.join(dest_dir, f"{stem}_{n}{ext}")
            n += 1
        with open(dest, "wb") as f:
            f.write(blob)
        out = f"models/{sid}/{os.path.basename(dest)}"
        seen_files[rel] = out
        copied += 1
        return out


    for sid in wanted:
        variations = []
        for r in resolvers.get(sid, []):
            for v in (r.get("variations") or []):
                variations.append((r.get("order", 0), v))
        if not variations:
            continue
        # How Cobblemon actually resolves this: for a Pokemon with a given set of
        # aspects, every variation whose aspects are ALL present applies; they layer in
        # resolver order and the last one naming a model (or a texture) wins.
        #
        # The obvious shortcut — carry a running "base" forward and let each variation
        # inherit from it — is wrong, and quietly so. It lets a later resolver file's
        # model leak onto unrelated variations: Charizard's plain form came out wearing
        # charizard_mega_x_clone, and every "<form>, shiny" row inherited whatever model
        # happened to be last rather than its own form's.
        ordered = sorted(enumerate(variations), key=lambda x: (x[1][0], x[0]))
        rows = []
        for _i, (_order, v) in ordered:
            asp = [str(a) for a in (v.get("aspects") or [])]
            mine = {str(a).lower() for a in asp}
            model = tex = None
            layers = {}
            for _j, (_o2, w) in ordered:
                wasp = {str(a).lower() for a in (w.get("aspects") or [])}
                if not wasp <= mine:            # needs an aspect this one doesn't have
                    continue
                if w.get("model"):
                    model = w["model"]
                t = first_frame(w.get("texture"))
                if t:
                    tex = t
                # A resolver can hang extra texture LAYERS off a variation, each drawn
                # over the model on its own pass. That is where Vivillon's wing patterns
                # live, and its main texture is transparent where the wings are — ignore
                # the layers and the wings simply are not there. Keyed by name so a later
                # variation swaps a layer rather than stacking a second copy of it.
                for L in (w.get("layers") or []):
                    if not isinstance(L, dict):
                        continue
                    lt = first_frame(L.get("texture"))
                    if lt:
                        layers[str(L.get("name") or f"_{len(layers)}")] = lt
            if not model or not tex:
                continue
            rows.append({"aspects": asp, "model": model, "texture": tex,
                         "layers": list(layers.values())})

        out_rows = []
        for row in rows:
            mid = str(row["model"])
            stem = mid.split(":")[-1].replace(".geo", "").split("/")[-1]
            # Cobblemon loads a model by its FILE, so match the filename first. The
            # identifier inside is not reliably unique — 524 of them are claimed by more
            # than one file in this corpus, and 432 files simply say "geometry.unknown".
            # Trusting the identifier hands a Pokemon somebody else's geometry, which is
            # what made so many models look scrambled.
            grel = geo_by_file.get(stem.lower()) or geo_by_file.get(stem) \
                or geo_by_id.get("geometry." + stem) or geo_by_id.get(stem)
            if not grel:
                missing_model += 1
                continue
            ns, rest = res_path(row["texture"], None, ".png")
            trel = f"assets/{ns}/{rest}" if not str(rest).startswith("assets/") else str(rest)
            if trel not in src.files:
                missing_tex += 1
                continue
            # Layers are shipped as their own files and stacked by the viewer on a canvas.
            # Flattening them here with Pillow was tried and reverted: Pillow is not in a
            # stock Python, and the fallback quietly produced bare textures instead —
            # Vivillon lost its wings again and nothing said why.
            lays = []
            for lt in (row.get("layers") or []):
                lns, lrest = res_path(lt, None, ".png")
                lrel = f"assets/{lns}/{lrest}" if not str(lrest).startswith("assets/") else str(lrest)
                if lrel in src.files and lrel != trel:
                    lp = stash(lrel, sid)
                    if lp:
                        lays.append(lp)
            g = stash(grel, sid)
            t = stash(trel, sid)
            if not g or not t:
                continue
            shiny = trel.replace(".png", "_shiny.png")
            s = stash(shiny, sid) if shiny in src.files else None
            pose, poser = pose_for(row["model"])
            entry = {"aspects": row["aspects"], "model": g, "texture": t, "shiny": s}
            if lays:
                entry["layers"] = lays
            if pose:
                entry["pose"] = pose
            if poser and poser.get("rootBone"):
                entry["root"] = poser["rootBone"]
            out_rows.append(entry)
        if out_rows:
            manifest[sid] = out_rows

    with open(os.path.join(HERE, "data", "models.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(dp, fn))
                for dp, dn, fns in os.walk(OUT_MODELS) for fn in fns)
    print()
    print(f"species with models : {len(manifest)} of {len(wanted)}")
    print(f"files written       : {copied}  ({total/1e6:.0f} MB)")
    # worth stating out loud: when this reads 0, Vivillon has no wings
    layered = sum(1 for rows in manifest.values() for r in rows if r.get("layers"))
    posed = sum(1 for rows in manifest.values() for r in rows if r.get("pose"))
    entries = sum(len(rows) for rows in manifest.values())
    print(f"model entries       : {entries}  ({posed} posed, {layered} with texture layers)")
    if missing_model or missing_tex:
        print(f"skipped             : {missing_model} missing geometry, {missing_tex} missing texture")
    print("\ndone — reload the wiki and the models will be there.")


if __name__ == "__main__":
    main()
