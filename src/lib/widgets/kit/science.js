/*
 * Zeff's science kit — in every widget's frame after kit.js (lib/widgets/libs.ts puts it in), adds to window.ZeffKit:
 *
 *   numbers   linspace, range, ode (Runge–Kutta 4 / adaptive RK45), integrate (Simpson), root (Brent), minimize (golden section),
 *             derivative, grid (a function sampled over a plane — for Plotly surfaces), fit (least squares polynomial)
 *   colour    colormap(name, t) — viridis, plasma, inferno, magma, cividis, turbo, coolwarm, gray — and colormapScale(name, n)
 *   math      tex(el, latex) (KaTeX when it is there)
 *   3D        scene(el, opts) — three.js set up in one line: renderer, camera, light, orbit controls, labels, glow, resize, dark mode,
 *             a frame loop; isosurface(fn, opts) — an organic surface from a field (marching cubes): a brain, a cell, an orbital
 *   answers   pods(el, pods) — results one under the other (title, TeX, text, a table, a plot); alpha(el, opts) — ask in words,
 *             the AI turns it into maths, mathjs and Algebrite compute it here, the results as pods (Wolfram|Alpha-like)
 *
 * Plain browser JavaScript, no build step; what needs a library (THREE, math, Algebrite, katex, Plotly) says so when it is missing.
 */
(function () {
  "use strict";
  var K = (window.ZeffKit = window.ZeffKit || {});
  var need = function (name, what) {
    if (!window[name]) throw new Error(what + " needs the library “" + ({ THREE: "three", math: "mathjs", Algebrite: "algebrite", katex: "katex", Plotly: "plotly" }[name] || name) + "” in libs");
    return window[name];
  };
  var target = function (el) {
    var e = typeof el === "string" ? document.querySelector(el) : el;
    if (!e) throw new Error("no element " + el);
    return e;
  };
  var dark = function () {
    try {
      return getComputedStyle(document.documentElement).colorScheme.indexOf("dark") >= 0;
    } catch (e) {
      return false;
    }
  };

  // ------------------------------------------------------------------ numbers
  K.linspace = function (a, b, n) {
    n = Math.max(2, n || 100);
    var out = [];
    for (var i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  };
  K.range = function (a, b, step) {
    var out = [];
    step = step || 1;
    for (var x = a; step > 0 ? x < b : x > b; x += step) out.push(x);
    return out;
  };
  var add = function (y, k, h) {
    return y.map(function (v, i) {
      return v + k[i] * h;
    });
  };
  /**
   * An ODE y' = f(t, y) (y a number or a list) from t0 to t1: { t: [...], y: [[...]] }. opts.steps (fixed RK4, default 500) or
   * opts.tol (adaptive RK45, Dormand–Prince).
   */
  K.ode = function (f, y0, span, opts) {
    opts = opts || {};
    var scalar = !Array.isArray(y0);
    var F = function (t, y) {
      var r = f(t, scalar ? y[0] : y);
      return Array.isArray(r) ? r : [r];
    };
    var t = span[0],
      t1 = span[1],
      y = scalar ? [y0] : y0.slice();
    var T = [t],
      Y = [scalar ? y[0] : y.slice()];
    if (opts.tol) {
      var h = (t1 - t) / 100,
        tol = opts.tol,
        guard = 0;
      while ((t1 - t) * Math.sign(h) > 1e-12 && guard++ < 200000) {
        if ((t + h - t1) * Math.sign(h) > 0) h = t1 - t;
        var k1 = F(t, y),
          k2 = F(t + h / 5, add(y, k1, h / 5)),
          k3 = F(t + (3 * h) / 10, y.map(function (v, i) { return v + h * ((3 / 40) * k1[i] + (9 / 40) * k2[i]); })),
          k4 = F(t + (4 * h) / 5, y.map(function (v, i) { return v + h * ((44 / 45) * k1[i] - (56 / 15) * k2[i] + (32 / 9) * k3[i]); })),
          k5 = F(t + (8 * h) / 9, y.map(function (v, i) { return v + h * ((19372 / 6561) * k1[i] - (25360 / 2187) * k2[i] + (64448 / 6561) * k3[i] - (212 / 729) * k4[i]); })),
          k6 = F(t + h, y.map(function (v, i) { return v + h * ((9017 / 3168) * k1[i] - (355 / 33) * k2[i] + (46732 / 5247) * k3[i] + (49 / 176) * k4[i] - (5103 / 18656) * k5[i]); }));
        var y5 = y.map(function (v, i) { return v + h * ((35 / 384) * k1[i] + (500 / 1113) * k3[i] + (125 / 192) * k4[i] - (2187 / 6784) * k5[i] + (11 / 84) * k6[i]); });
        var k7 = F(t + h, y5);
        var err = Math.max.apply(null, y.map(function (v, i) {
          var y4 = v + h * ((5179 / 57600) * k1[i] + (7571 / 16695) * k3[i] + (393 / 640) * k4[i] - (92097 / 339200) * k5[i] + (187 / 2100) * k6[i] + (1 / 40) * k7[i]);
          return Math.abs(y5[i] - y4) / (tol + tol * Math.abs(y5[i]));
        }));
        if (err <= 1 || Math.abs(h) < 1e-12) {
          t += h;
          y = y5;
          T.push(t);
          Y.push(scalar ? y[0] : y.slice());
        }
        h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(err || 1e-10, -0.2)));
      }
    } else {
      var n = opts.steps || 500,
        dt = (t1 - t) / n;
      for (var s = 0; s < n; s++) {
        var a = F(t, y),
          b = F(t + dt / 2, add(y, a, dt / 2)),
          c = F(t + dt / 2, add(y, b, dt / 2)),
          d = F(t + dt, add(y, c, dt));
        y = y.map(function (v, i) { return v + (dt / 6) * (a[i] + 2 * b[i] + 2 * c[i] + d[i]); });
        t += dt;
        T.push(t);
        Y.push(scalar ? y[0] : y.slice());
      }
    }
    return { t: T, y: Y };
  };
  /** ∫ f from a to b (Simpson, n even, default 1000). */
  K.integrate = function (f, a, b, n) {
    n = n || 1000;
    if (n % 2) n++;
    var h = (b - a) / n,
      s = f(a) + f(b);
    for (var i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
  };
  /** A root of f in [a, b] (Brent) — f(a) and f(b) of different signs. */
  K.root = function (f, a, b, tol) {
    tol = tol || 1e-12;
    var fa = f(a),
      fb = f(b);
    if (fa * fb > 0) throw new Error("root: f(a) and f(b) have the same sign");
    var c = a,
      fc = fa,
      d = b - a,
      e = d;
    for (var it = 0; it < 200; it++) {
      if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      var m = (c - b) / 2,
        tl = 2 * 1e-16 * Math.abs(b) + tol;
      if (Math.abs(m) <= tl || fb === 0) return b;
      if (Math.abs(e) >= tl && Math.abs(fa) > Math.abs(fb)) {
        var s = fb / fa, p, q;
        if (a === c) { p = 2 * m * s; q = 1 - s; }
        else { var r = fb / fc; q = fa / fc; p = s * (2 * m * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tl * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
      } else { d = m; e = m; }
      a = b;
      fa = fb;
      b += Math.abs(d) > tl ? d : m > 0 ? tl : -tl;
      fb = f(b);
    }
    return b;
  };
  /** The x in [a, b] where f is least (golden section). */
  K.minimize = function (f, a, b, tol) {
    tol = tol || 1e-9;
    var g = (Math.sqrt(5) - 1) / 2,
      c = b - g * (b - a),
      d = a + g * (b - a);
    while (Math.abs(b - a) > tol) {
      if (f(c) < f(d)) b = d; else a = c;
      c = b - g * (b - a);
      d = a + g * (b - a);
    }
    return (a + b) / 2;
  };
  K.derivative = function (f, x, h) {
    h = h || 1e-5;
    return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h);
  };
  /** f(x, y) over a grid — { x: [...], y: [...], z: [[...]] } as Plotly's surface/contour/heatmap take it. */
  K.grid = function (f, xs, ys) {
    return { x: xs, y: ys, z: ys.map(function (y) { return xs.map(function (x) { return f(x, y); }); }) };
  };
  /** A least-squares polynomial of a degree through points [[x, y], …]: { coef: [c0, c1, …], f(x), r2 }. */
  K.fit = function (points, degree) {
    var n = (degree || 1) + 1;
    var A = [], b = [];
    for (var i = 0; i < n; i++) {
      A.push([]);
      for (var j = 0; j < n; j++) A[i].push(points.reduce(function (s, p) { return s + Math.pow(p[0], i + j); }, 0));
      b.push(points.reduce(function (s, p) { return s + p[1] * Math.pow(p[0], i); }, 0));
    }
    for (var k = 0; k < n; k++) {
      var piv = k;
      for (var r = k + 1; r < n; r++) if (Math.abs(A[r][k]) > Math.abs(A[piv][k])) piv = r;
      var tmp = A[k]; A[k] = A[piv]; A[piv] = tmp;
      var tb = b[k]; b[k] = b[piv]; b[piv] = tb;
      for (var r2 = k + 1; r2 < n; r2++) {
        var fct = A[r2][k] / A[k][k];
        for (var c2 = k; c2 < n; c2++) A[r2][c2] -= fct * A[k][c2];
        b[r2] -= fct * b[k];
      }
    }
    var coef = new Array(n);
    for (var i2 = n - 1; i2 >= 0; i2--) {
      var s = b[i2];
      for (var j2 = i2 + 1; j2 < n; j2++) s -= A[i2][j2] * coef[j2];
      coef[i2] = s / A[i2][i2];
    }
    var f = function (x) { return coef.reduce(function (s, c, i) { return s + c * Math.pow(x, i); }, 0); };
    var mean = points.reduce(function (s, p) { return s + p[1]; }, 0) / points.length;
    var ssr = points.reduce(function (s, p) { return s + Math.pow(p[1] - f(p[0]), 2); }, 0);
    var sst = points.reduce(function (s, p) { return s + Math.pow(p[1] - mean, 2); }, 0);
    return { coef: coef, f: f, r2: sst ? 1 - ssr / sst : 1 };
  };

  // ------------------------------------------------------------------ colour
  var MAPS = {
    viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
    plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
    inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
    magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
    cividis: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#fee838"],
    turbo: ["#30123b", "#4662d7", "#36aaf9", "#1ae4b6", "#72fe5e", "#c7ef34", "#fbb938", "#f56918", "#c92903", "#7a0403"],
    coolwarm: ["#3b4cc0", "#5977e3", "#7b9ff9", "#9ebeff", "#c0d4f5", "#dddcdc", "#f2cbb7", "#f7ac8e", "#ee8468", "#d65244", "#b40426"],
    gray: ["#000000", "#ffffff"],
  };
  var hex = function (h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  };
  /** A colour of a scientific colour map at t (0–1), as "rgb(r,g,b)". */
  K.colormap = function (name, t) {
    var m = MAPS[name] || MAPS.viridis;
    t = Math.max(0, Math.min(1, Number(t) || 0)) * (m.length - 1);
    var i = Math.min(m.length - 2, Math.floor(t)),
      f = t - i,
      a = hex(m[i]),
      b = hex(m[i + 1]);
    return "rgb(" + a.map(function (v, k) { return Math.round(v + (b[k] - v) * f); }).join(",") + ")";
  };
  /** n colours of a map — and as Plotly takes a colour scale: colormapScale(name). */
  K.colormapScale = function (name, n) {
    n = n || 10;
    return K.linspace(0, 1, n).map(function (t) { return [t, K.colormap(name, t)]; });
  };
  K.colormaps = Object.keys(MAPS);

  // ------------------------------------------------------------------ maths shown
  K.tex = function (el, latex, display) {
    el = target(el);
    if (window.katex) window.katex.render(String(latex), el, { throwOnError: false, displayMode: display !== false });
    else el.textContent = String(latex);
    return el;
  };

  // ------------------------------------------------------------------ 3D
  /**
   * three.js in one line: ZeffKit.scene(el, { height: 420, camera: [0, 0, 6], background, controls: true, autoRotate, bloom, labels: true })
   * → { THREE, scene, camera, renderer, controls, add(obj), label(obj, text, [x,y,z]), onFrame(fn(dt, t)), fit(obj), dispose() }.
   * Lights for a studio look, the size following the element, dark mode followed.
   */
  K.scene = function (el, o) {
    var THREE = need("THREE", "ZeffKit.scene");
    o = o || {};
    el = target(el);
    el.style.position = el.style.position || "relative";
    var h = o.height || 420;
    var w = el.clientWidth || 600;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !o.background, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    if (o.background) scene.background = new THREE.Color(o.background);
    var camera = new THREE.PerspectiveCamera(o.fov || 45, w / h, 0.01, 2000);
    var cp = o.camera || [0, 0, 6];
    camera.position.set(cp[0], cp[1], cp[2]);
    scene.add(new THREE.HemisphereLight(0xffffff, dark() ? 0x202030 : 0x8090a0, 0.9));
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 5);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x99bbff, 0.6);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    var controls = null;
    if (o.controls !== false && THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = !!o.autoRotate;
      controls.autoRotateSpeed = o.autoRotateSpeed || 1.2;
    }
    var labels = null;
    if (o.labels !== false && THREE.CSS2DRenderer) {
      labels = new THREE.CSS2DRenderer();
      labels.setSize(w, h);
      labels.domElement.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
      el.appendChild(labels.domElement);
    }
    var composer = null;
    if (o.bloom && THREE.EffectComposer) {
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene, camera));
      composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(w, h), typeof o.bloom === "number" ? o.bloom : 0.8, 0.4, 0.2));
      if (THREE.OutputPass) composer.addPass(new THREE.OutputPass());
    }
    var frames = [];
    var clock = new THREE.Clock();
    var alive = true;
    var loop = function () {
      if (!alive) return;
      requestAnimationFrame(loop);
      var dt = clock.getDelta(), t = clock.elapsedTime;
      for (var i = 0; i < frames.length; i++) frames[i](dt, t);
      if (controls) controls.update();
      if (composer) composer.render(); else renderer.render(scene, camera);
      if (labels) labels.render(scene, camera);
    };
    loop();
    var resize = function () {
      var nw = el.clientWidth || w;
      if (Math.abs(nw - w) < 2) return;
      w = nw;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (labels) labels.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el);
    var api = {
      THREE: THREE,
      scene: scene,
      camera: camera,
      renderer: renderer,
      controls: controls,
      composer: composer,
      add: function (obj) { scene.add(obj); return obj; },
      /** A label that stays on a part: label(mesh, "Hippocampus", [0, 0.3, 0]). */
      label: function (obj, text, at) {
        if (!THREE.CSS2DObject) return null;
        var d = document.createElement("div");
        d.textContent = text;
        d.style.cssText = "font:12px system-ui,sans-serif;padding:2px 6px;border-radius:6px;background:" + (dark() ? "rgba(24,24,27,.8)" : "rgba(255,255,255,.85)") + ";color:" + (dark() ? "#ececf1" : "#18181b") + ";white-space:nowrap";
        var l = new THREE.CSS2DObject(d);
        if (at) l.position.set(at[0], at[1], at[2]);
        (obj || scene).add(l);
        return l;
      },
      onFrame: function (fn) { frames.push(fn); },
      /** The camera moved to show an object whole. */
      fit: function (obj) {
        var box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()).length(), c = box.getCenter(new THREE.Vector3());
        camera.position.copy(c).add(new THREE.Vector3(0, size * 0.15, size * 1.1));
        camera.lookAt(c);
        if (controls) controls.target.copy(c);
      },
      dispose: function () { alive = false; renderer.dispose(); },
    };
    return api;
  };

  /**
   * An organic surface where a field passes a level (marching cubes): isosurface((x, y, z) => value, { resolution: 64,
   * bounds: 1.5, iso: 0, color, material, colorBy: (x,y,z) => 0..1, map: "viridis" }) → a THREE.Mesh (x, y, z from −bounds to
   * bounds). The inside is where value > iso. A brain: two ellipsoids, folds from noise — see the guide's example.
   */
  K.isosurface = function (fn, o) {
    var THREE = need("THREE", "ZeffKit.isosurface");
    o = o || {};
    var res = Math.max(16, Math.min(128, o.resolution || 64));
    var B = o.bounds || 1.5;
    var mat = o.material || new THREE.MeshStandardMaterial({ color: o.color || 0xe8a0a0, roughness: 0.55, metalness: 0.05, vertexColors: !!o.colorBy });
    var mc = new THREE.MarchingCubes(res, mat, false, !!o.colorBy, Math.max(90000, res * res * 60));
    mc.isolation = 0;
    var iso = o.iso || 0;
    for (var k = 0; k < res; k++)
      for (var j = 0; j < res; j++)
        for (var i = 0; i < res; i++) {
          var x = ((i / (res - 1)) * 2 - 1) * B, y = ((j / (res - 1)) * 2 - 1) * B, z = ((k / (res - 1)) * 2 - 1) * B;
          var idx = i + j * res + k * res * res;
          // (Marching cubes looks for where the field crosses its isolation: shifted so iso is 0, and kept off the box's edge.)
          var edge = i === 0 || j === 0 || k === 0 || i === res - 1 || j === res - 1 || k === res - 1;
          mc.field[idx] = edge ? -1 : fn(x, y, z) - iso;
          if (o.colorBy) {
            var c = new THREE.Color(K.colormap(o.map || "viridis", o.colorBy(x, y, z)));
            mc.palette[idx * 3] = c.r;
            mc.palette[idx * 3 + 1] = c.g;
            mc.palette[idx * 3 + 2] = c.b;
          }
        }
    mc.update();
    // Its own geometry (marching cubes' buffer is fixed-size): a plain mesh, scaled to the bounds.
    var g = mc.geometry.clone();
    g.setDrawRange(0, mc.count);
    var mesh = new THREE.Mesh(g, mat);
    mesh.scale.setScalar(B);
    return mesh;
  };

  // ------------------------------------------------------------------ answers (pods)
  var css = function () {
    if (document.getElementById("zk-sci-style")) return;
    var s = document.createElement("style");
    s.id = "zk-sci-style";
    s.textContent =
      ".zk-pods{display:flex;flex-direction:column;gap:10px}.zk-pod{border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:10px;overflow:hidden}" +
      ".zk-pod>h4{margin:0;padding:6px 12px;font-size:12px;font-weight:600;opacity:.75;background:color-mix(in srgb,currentColor 6%,transparent)}" +
      ".zk-pod>.zk-body{padding:10px 12px;overflow-x:auto}.zk-pod table{border-collapse:collapse;font-size:13px}.zk-pod td,.zk-pod th{padding:2px 10px;text-align:right;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}" +
      ".zk-alpha form{display:flex;gap:8px;margin-bottom:12px}.zk-alpha input{flex:1;font:inherit;padding:8px 12px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit}" +
      ".zk-alpha button{font:inherit;padding:8px 14px;border-radius:10px;border:0;background:#4f46e5;color:#fff;cursor:pointer}.zk-alpha .zk-note{font-size:13px;opacity:.7;margin:0 0 8px}.zk-err{color:#dc2626}";
    document.head.appendChild(s);
  };
  /**
   * Results one under the other: pods(el, [{ title, tex?, text?, html?, table?: { head?, rows }, plot?: { expr | fn, var?, from, to }
   * | plotly?: { data, layout } }]). A plot needs Plotly (or falls back to ZeffKit.plot).
   */
  K.pods = function (el, pods) {
    el = target(el);
    css();
    var root = document.createElement("div");
    root.className = "zk-pods";
    (pods || []).forEach(function (p) {
      var pod = document.createElement("section");
      pod.className = "zk-pod";
      var hd = document.createElement("h4");
      hd.textContent = p.title || "";
      var body = document.createElement("div");
      body.className = "zk-body";
      pod.appendChild(hd);
      pod.appendChild(body);
      root.appendChild(pod);
      try {
        if (p.error) {
          body.className += " zk-err";
          body.textContent = p.error;
        } else if (p.tex) K.tex(body, p.tex);
        else if (p.html) body.innerHTML = p.html;
        else if (p.table) {
          var t = document.createElement("table");
          if (p.table.head) t.innerHTML = "<tr>" + p.table.head.map(function (x) { return "<th>" + String(x).replace(/</g, "&lt;") + "</th>"; }).join("") + "</tr>";
          (p.table.rows || []).forEach(function (r) {
            var tr = document.createElement("tr");
            r.forEach(function (c) { var td = document.createElement("td"); td.textContent = String(c); tr.appendChild(td); });
            t.appendChild(tr);
          });
          body.appendChild(t);
        } else if (p.plotly && window.Plotly) {
          window.Plotly.newPlot(body, p.plotly.data, Object.assign({ height: 300, margin: { l: 40, r: 10, t: 10, b: 30 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: dark() ? "#ececf1" : "#18181b" } }, p.plotly.layout || {}), { displaylogo: false, responsive: true });
        } else if (p.plot) {
          var f = p.plot.fn || (window.math ? window.math.compile(p.plot.expr) : null);
          var v = p.plot.var || "x";
          var call = function (x) { var s = {}; s[v] = x; return typeof f === "function" ? f(x) : f.evaluate(s); };
          var xs = K.linspace(p.plot.from == null ? -10 : p.plot.from, p.plot.to == null ? 10 : p.plot.to, 400);
          var ys = xs.map(function (x) { try { var y = Number(call(x)); return isFinite(y) ? y : null; } catch (e) { return null; } });
          if (window.Plotly) window.Plotly.newPlot(body, [{ x: xs, y: ys, mode: "lines", line: { color: "#4f46e5" } }], { height: 280, margin: { l: 40, r: 10, t: 10, b: 30 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: dark() ? "#ececf1" : "#18181b" }, xaxis: { title: v } }, { displaylogo: false, responsive: true });
          else body.textContent = "(a plot needs the library “plotly”)";
        } else body.textContent = p.text == null ? "" : String(p.text);
      } catch (e) {
        body.className += " zk-err";
        body.textContent = String((e && e.message) || e);
      }
    });
    el.innerHTML = "";
    el.appendChild(root);
    return root;
  };

  var ALPHA_SCHEMA = {
    type: "object",
    required: ["interpretation", "steps"],
    properties: {
      interpretation: { type: "string", description: "How the question was understood, as plain maths or words (TeX allowed in $…$)." },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            mathjs: { type: "string", description: "An expression mathjs evaluates (numbers, units like '5 km/h to m/s' — mathjs unit names: mi/h not mph, degC, kWh, matrices, derivative('x^2','x'), constants like speedOfLight)." },
            algebrite: { type: "string", description: "An Algebrite command for algebra: integral(...), defint(...), factor(...), roots(...), nroots(...), simplify(...), taylor(...), expand(...)." },
            plot: { type: "object", properties: { expr: { type: "string" }, var: { type: "string" }, from: { type: "number" }, to: { type: "number" } } },
            text: { type: "string", description: "Facts that aren't computed (a definition, a known value) — only when you are sure." },
          },
        },
      },
    },
  };
  var texOf = function (s) {
    try {
      if (window.Algebrite) return String(window.Algebrite.run("printlatex(" + s + ")")).trim();
    } catch (e) {}
    return null;
  };
  /**
   * Ask in words, answered with maths — Wolfram|Alpha-like: alpha(el, { placeholder, examples: [...], language }). Needs the libs
   * mathjs and algebrite (katex for formulas, plotly for plots) and the AI (ai: true): the AI only says WHAT to compute (as mathjs /
   * Algebrite input); the computing happens here, so the numbers are exact and every step is shown.
   */
  K.alpha = function (el, o) {
    need("math", "ZeffKit.alpha");
    o = o || {};
    el = target(el);
    css();
    el.innerHTML = "";
    var box = document.createElement("div");
    box.className = "zk-alpha";
    var form = document.createElement("form");
    var input = document.createElement("input");
    input.placeholder = o.placeholder || "integrate x^2 sin x · 60 mi/h in m/s · solve x^3-2x=1 · plot sin(x)/x";
    input.setAttribute("aria-label", input.placeholder);
    var go = document.createElement("button");
    go.type = "submit";
    go.textContent = o.button || "=";
    form.appendChild(input);
    form.appendChild(go);
    var note = document.createElement("p");
    note.className = "zk-note";
    var out = document.createElement("div");
    box.appendChild(form);
    box.appendChild(note);
    box.appendChild(out);
    el.appendChild(box);
    if (o.examples && o.examples.length) {
      note.textContent = "";
      o.examples.forEach(function (ex) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = ex;
        b.style.cssText = "background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 20%,transparent);padding:2px 10px;margin:0 6px 6px 0;font-size:13px";
        b.onclick = function () { input.value = ex; run(); };
        note.appendChild(b);
      });
    }
    var compute = function (step) {
      if (step.algebrite && window.Algebrite) {
        var r = String(window.Algebrite.run(step.algebrite)).trim();
        if (/^Stop|error/i.test(r)) throw new Error(r);
        var tex = texOf(step.algebrite);
        return tex ? { tex: tex } : { text: r };
      }
      if (step.mathjs) {
        var v = window.math.evaluate(step.mathjs);
        var s = window.math.format(v, { precision: 12 });
        try {
          if (window.katex && v && typeof v === "object" && v.toTex) return { tex: v.toTex() };
        } catch (e) {}
        return { text: s };
      }
      if (step.plot) return { plot: step.plot };
      return { text: step.text || "" };
    };
    var run = function () {
      var q = input.value.trim();
      if (!q) return;
      out.innerHTML = "";
      note.textContent = "…";
      if (!window.zeff || !window.zeff.ai) { note.textContent = "needs the AI (ai: true)"; return; }
      window.zeff
        .ai(
          "Turn this question into maths for a calculator (mathjs and Algebrite run in the browser and compute it; you don't compute). Question: " + q +
            "\nGive: interpretation (one line), steps: the results worth showing (input as understood, result, a decimal value, a plot when a function is involved, steps such as a derivative). Use mathjs for numbers, units, matrices and statistics; Algebrite for algebra (integrals, solving, factoring, series). Answer in the question's language.",
          { schema: ALPHA_SCHEMA },
        )
        .then(function (a) {
          note.textContent = "";
          var pods = [{ title: o.inputTitle || "Input", tex: null, text: a.interpretation }];
          (a.steps || []).forEach(function (s) {
            try {
              var r = compute(s);
              pods.push(Object.assign({ title: s.title }, r));
            } catch (e) {
              pods.push({ title: s.title, error: String((e && e.message) || e) });
            }
          });
          K.pods(out, pods);
        })
        .catch(function (e) {
          note.textContent = "";
          out.innerHTML = "";
          K.pods(out, [{ title: "Error", error: String((e && e.message) || e) }]);
        });
    };
    form.onsubmit = function (e) { e.preventDefault(); run(); };
    return { input: input, run: run, compute: compute };
  };
})();
