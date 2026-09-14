/* Bedrock model viewer.
 *
 * Cobblemon ships its Pokemon as Bedrock geometry — a bone tree of axis-aligned boxes
 * with UVs into one texture atlas. Every one of the 1496 addon models and Cobblemon's
 * own are pure cubes, no meshes, so this bakes the bone transforms into a single static
 * vertex buffer at load and draws it with a small WebGL shader. No dependencies.
 */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- maths */
  function ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function translate(x, y, z) { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scale(x, y, z) { const m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function rotX(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[5]=c; m[6]=s; m[9]=-s; m[10]=c; return m; }
  function rotY(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0]=c; m[2]=-s; m[8]=s; m[10]=c; return m; }
  function rotZ(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0]=c; m[1]=s; m[4]=-s; m[5]=c; return m; }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[11] = -1;
    o[10] = (far + near) / (near - far); o[14] = (2 * far * near) / (near - far);
    return o;
  }
  function xform(m, x, y, z) {
    return [m[0]*x + m[4]*y + m[8]*z + m[12],
            m[1]*x + m[5]*y + m[9]*z + m[13],
            m[2]*x + m[6]*y + m[10]*z + m[14]];
  }
  const rad = d => (d || 0) * Math.PI / 180;

  /* ------------------------------------------------- geometry construction */
  // Bedrock face -> unit-cube corners (in cube-local space) and its normal.
  // north is -Z, south is +Z, east is +X, west is -X.
  const FACES = {
    north: { n: [0, 0, -1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
    south: { n: [0, 0,  1], v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
    east:  { n: [1, 0,  0], v: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
    west:  { n: [-1, 0, 0], v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
    up:    { n: [0, 1,  0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
    down:  { n: [0,-1,  0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  };

  // where each face sits in the standard box-UV net, given cube size [w,h,d]
  function boxUV(u, v, w, h, d) {
    return {
      up:    [u + d,         v,     w,  d],
      down:  [u + d + w,     v,     w,  d],
      west:  [u,             v + d, d,  h],
      north: [u + d,         v + d, w,  h],
      east:  [u + d + w,     v + d, d,  h],
      south: [u + d + w + d, v + d, w,  h],
    };
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("texture failed: " + url));
      img.src = url;
    });
  }

  // A resolver can hang extra texture LAYERS off a variation — each is drawn over the
  // model on its own pass, sharing the same UVs. That is where Vivillon's wing patterns
  // and Mega Typhlosion's flames live, and the main texture is transparent underneath
  // them, so without this the wings and flames are simply absent. Stacking them on a
  // canvas is the same picture, and costs nothing at build time.
  function flatten(base, overlays) {
    const cv = document.createElement("canvas");
    cv.width = base.naturalWidth || base.width;
    cv.height = base.naturalHeight || base.height;
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0);
    for (const o of overlays) {
      if (o) g.drawImage(o, 0, 0, cv.width, cv.height);  // a layer sheet may be scaled
    }
    return cv;
  }

  function build(geo, pose) {
    pose = pose || {};
    const desc = geo.description || {};
    const texW = desc.texture_width || 64, texH = desc.texture_height || 64;
    const bones = geo.bones || [];
    const byName = {};
    bones.forEach(b => { if (b.name) byName[b.name] = b; });

    // bone -> world matrix, resolved through its parents
    const cache = {};
    function boneMatrix(b, depth) {
      if (!b || depth > 24) return ident();
      if (cache[b.name]) return cache[b.name];
      const parent = b.parent && byName[b.parent] !== b ? byName[b.parent] : null;
      const p = parent ? boneMatrix(parent, depth + 1) : ident();
      const piv = b.pivot || [0, 0, 0];
      // the poser's still frame, on top of whatever the bone already declares
      const ap = pose[b.name] || {};
      const ar = ap.rot || [0, 0, 0];
      const at = ap.pos || [0, 0, 0];
      const br = b.rotation || [0, 0, 0];
      let m = mul(p, translate(piv[0] + at[0], piv[1] + at[1], piv[2] + at[2]));
      // SIGNS: two conversions stack, and getting them wrong scattered models across the
      // screen. Bedrock's X and Y turn the opposite way to GL's, so both start negated.
      // Then the model is drawn through scale(-1,1,1) to match Bedrock's mirrored X, and
      // M*R*M-inverse flips rotation about Y and Z while leaving X alone. Y is negated
      // twice and comes back positive; X and Z stay negated. Net: -X, +Y, -Z.
      // Checked, not reasoned: under each candidate convention, count the vertices that
      // land outside the visible_bounds box the model's own author declared. Over 400
      // models this one puts 0.06% outside, against 0.15% for -X,-Y,+Z and worse for the
      // rest. A symmetric Pokemon hid the bug for months — swapping Y and Z signs just
      // trades its left side for its right.
      m = mul(m, rotZ(rad(-((br[2] || 0) + ar[2]))));
      m = mul(m, rotY(rad(((br[1] || 0) + ar[1]))));
      m = mul(m, rotX(rad(-((br[0] || 0) + ar[0]))));
      m = mul(m, translate(-piv[0], -piv[1], -piv[2]));
      cache[b.name] = m;
      return m;
    }

    const pos = [], uvs = [], nrm = [];
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];

    for (const b of bones) {
      const bm = boneMatrix(b, 0);
      for (const cube of (b.cubes || [])) {
        const o = cube.origin || [0, 0, 0];
        const s = cube.size || [0, 0, 0];
        const inf = cube.inflate || 0;
        const x0 = o[0] - inf, y0 = o[1] - inf, z0 = o[2] - inf;
        const w = s[0] + inf * 2, h = s[1] + inf * 2, d = s[2] + inf * 2;

        // a cube may carry its own rotation about its own pivot
        let cm = bm;
        if (cube.rotation) {
          const cp = cube.pivot || [x0 + w / 2, y0 + h / 2, z0 + d / 2];
          cm = mul(cm, translate(cp[0], cp[1], cp[2]));
          // same convention as a bone's, for the same reason — 3139 of 3703 models here
          // rotate cubes this way (65,929 of them), and Noibat's face quads swung out to
          // x = -16 instead of onto its face
          cm = mul(cm, rotZ(rad(-cube.rotation[2])));
          cm = mul(cm, rotY(rad(cube.rotation[1])));
          cm = mul(cm, rotX(rad(-cube.rotation[0])));
          cm = mul(cm, translate(-cp[0], -cp[1], -cp[2]));
        }

        const perFace = cube.uv && !Array.isArray(cube.uv);
        const net = perFace ? null : boxUV((cube.uv || [0,0])[0], (cube.uv || [0,0])[1], w, h, d);

        for (const fname of Object.keys(FACES)) {
          const F = FACES[fname];
          let rect;
          if (perFace) {
            const f = cube.uv[fname];
            if (!f || !f.uv) continue;
            const sz = f.uv_size || [0, 0];
            rect = [f.uv[0], f.uv[1], sz[0], sz[1]];
          } else {
            rect = net[fname];
          }
          const [ru, rv, rw, rh] = rect;
          // face corners, in the winding order above: 0,1,2 and 0,2,3
          const P = F.v.map(c => {
            const p = xform(cm, x0 + c[0] * w, y0 + c[1] * h, z0 + c[2] * d);
            for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
            return p;
          });
          // uv corners matching that winding: bottom-left, bottom-right, top-right, top-left
          const U = [
            [ru,        rv + rh],
            [ru + rw,   rv + rh],
            [ru + rw,   rv],
            [ru,        rv],
          ];
          const nx = xform(cm, F.n[0], F.n[1], F.n[2]);
          const n0 = xform(cm, 0, 0, 0);
          const N = [nx[0] - n0[0], nx[1] - n0[1], nx[2] - n0[2]];
          const L = Math.hypot(N[0], N[1], N[2]) || 1;
          for (const tri of [[0, 1, 2], [0, 2, 3]]) {
            for (const i of tri) {
              pos.push(P[i][0], P[i][1], P[i][2]);
              uvs.push(U[i][0] / texW, U[i][1] / texH);
              nrm.push(N[0] / L, N[1] / L, N[2] / L);
            }
          }
        }
      }
    }
    if (!pos.length) return null;
    return {
      pos: new Float32Array(pos), uv: new Float32Array(uvs), nrm: new Float32Array(nrm),
      count: pos.length / 3, min, max,
    };
  }

  /* ------------------------------------------------------------- rendering */
  const VS = `
    attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNrm;
    uniform mat4 uProj, uView, uModel;
    varying vec2 vUV; varying vec3 vN;
    void main(){ vUV = aUV; vN = mat3(uModel) * aNrm;
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;
  const FS = `
    precision mediump float;
    uniform sampler2D uTex;
    varying vec2 vUV; varying vec3 vN;
    void main(){
      vec4 c = texture2D(uTex, vUV);
      if (c.a < 0.05) discard;
      vec3 n = normalize(vN);
      float key  = max(dot(n, normalize(vec3(0.4, 0.85, 0.55))), 0.0);
      float fill = max(dot(n, normalize(vec3(-0.6, 0.25, -0.4))), 0.0);
      float l = 0.58 + 0.34 * key + 0.14 * fill;
      gl_FragColor = vec4(c.rgb * l, c.a);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  const FOV = Math.PI / 5.5;

  function Viewer(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error("no webgl");
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const loc = {
      aPos: gl.getAttribLocation(prog, "aPos"),
      aUV: gl.getAttribLocation(prog, "aUV"),
      aNrm: gl.getAttribLocation(prog, "aNrm"),
      uProj: gl.getUniformLocation(prog, "uProj"),
      uView: gl.getUniformLocation(prog, "uView"),
      uModel: gl.getUniformLocation(prog, "uModel"),
      uTex: gl.getUniformLocation(prog, "uTex"),
    };
    const buf = { pos: gl.createBuffer(), uv: gl.createBuffer(), nrm: gl.createBuffer() };
    const tex = gl.createTexture();

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);          // Bedrock's X is mirrored; skip winding grief
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let mesh = null, ready = false, raf = 0;
    const cam = { yaw: 0.65, pitch: 0.13, dist: 2.4, target: [0, 0, 0], radius: 1 };
    const home = { yaw: 0.65, pitch: 0.13, dist: 2.4 };
    let spin = true;

    function upload(m) {
      mesh = m;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv);  gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
      const c = [0, 1, 2].map(i => (m.min[i] + m.max[i]) / 2);
      const size = [0, 1, 2].map(i => m.max[i] - m.min[i]);
      // fit the bounding sphere, so a long tail or spread wings never crop
      cam.target = [c[0], c[1], c[2]];
      cam.radius = 0.5 * Math.hypot(size[0], size[1], size[2]) || 1;
      cam.dist = cam.radius / Math.sin(FOV / 2) * 1.04;
      home.yaw = 0.7; home.pitch = 0.14; home.dist = cam.dist;
      cam.yaw = home.yaw; cam.pitch = home.pitch;
    }

    function setTexture(img) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ready = true;
    }

    function draw() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!mesh || !ready) return;
      if (spin) cam.yaw += 0.004;

      const proj = perspective(FOV, Math.max(w, 1) / Math.max(h, 1), 0.1, 5000);
      const eye = [
        cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
        cam.target[1] + cam.dist * Math.sin(cam.pitch),
        cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
      ];
      // look-at, built by hand
      const f = [cam.target[0]-eye[0], cam.target[1]-eye[1], cam.target[2]-eye[2]];
      const fl = Math.hypot(f[0],f[1],f[2]) || 1; f[0]/=fl; f[1]/=fl; f[2]/=fl;
      const up = [0,1,0];
      let s = [f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0]];
      const sl = Math.hypot(s[0],s[1],s[2]) || 1; s = s.map(v => v/sl);
      const u = [s[1]*f[2]-s[2]*f[1], s[2]*f[0]-s[0]*f[2], s[0]*f[1]-s[1]*f[0]];
      const view = new Float32Array([
        s[0], u[0], -f[0], 0,
        s[1], u[1], -f[1], 0,
        s[2], u[2], -f[2], 0,
        -(s[0]*eye[0]+s[1]*eye[1]+s[2]*eye[2]),
        -(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),
         (f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2]), 1,
      ]);
      const model = scale(-1, 1, 1);   // Bedrock mirrors X

      gl.uniformMatrix4fv(loc.uProj, false, proj);
      gl.uniformMatrix4fv(loc.uView, false, view);
      gl.uniformMatrix4fv(loc.uModel, false, model);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.uTex, 0);
      for (const [a, b, n] of [[loc.aPos, buf.pos, 3], [loc.aUV, buf.uv, 2], [loc.aNrm, buf.nrm, 3]]) {
        if (a < 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, n, gl.FLOAT, false, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    function loop() { draw(); raf = global.requestAnimationFrame(loop); }

    /* pointer control */
    let drag = null;
    canvas.addEventListener("pointerdown", e => {
      drag = { x: e.clientX, y: e.clientY }; spin = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return;
      cam.yaw -= (e.clientX - drag.x) * 0.01;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    });
    const stop = e => { drag = null; };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      cam.dist = Math.max(cam.radius * 0.9, Math.min(cam.radius * 12, cam.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    }, { passive: false });

    loop();
    return {
      async load(modelUrl, textureUrl, pose, layers) {
        ready = false; mesh = null;
        const geoJson = await fetch(modelUrl).then(r => r.json());
        const geos = geoJson["minecraft:geometry"];
        if (!geos || !geos.length) throw new Error("not a bedrock model");
        const built = build(geos[0], pose);
        if (!built) throw new Error("model has no cubes");
        upload(built);
        const img = await loadImage(textureUrl);
        setTexture(layers && layers.length ? flatten(img, await Promise.all(
          layers.map(u => loadImage(u).catch(() => null)))) : img);
      },
      reset() { cam.yaw = home.yaw; cam.pitch = home.pitch; cam.dist = home.dist; },
      toggleSpin() { spin = !spin; return spin; },
      get spinning() { return spin; },
      destroy() { global.cancelAnimationFrame(raf); },
    };
  }

  global.BedrockViewer = { create: Viewer, build: build };
})(window);
