import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * The science libraries and kit in a real browser (Chrome, headless — skipped without it): every library loads into a widget's frame
 * under its CSP and puts its global there; the science kit computes (an ODE, an integral, a root, a fit); Algebrite and mathjs answer;
 * a three.js scene with an iso-surface (a "brain") renders pixels; ZeffKit.alpha turns a question (the AI's answer faked by the page)
 * into computed pods.
 */
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

async function open(html: string, libs: string[], host = "") {
  const { chromium } = await import("playwright-core");
  const { buildSrcdoc } = await import("@/lib/widgets/sandbox");
  const { libBundle } = await import("@/lib/widgets/libs");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (host) await page.addInitScript(host);
  const doc = buildSrcdoc(html, { inline: libBundle(libs), lang: "en" });
  await page.route("http://sci.test/", (r) => r.fulfill({ contentType: "text/html", body: doc }));
  await page.goto("http://sci.test/");
  return { page, browser, errors };
}

test("every library loads under the frame's rules and puts its global there", { skip: !CHROME && "no Chrome", timeout: 120000 }, async () => {
  const { WIDGET_LIBS } = await import("@/lib/widgets/sandbox");
  const globals: Record<string, string> = { katex: "katex", jsxgraph: "JXG", three: "THREE", chart: "Chart", mathjs: "math", algebrite: "Algebrite", plotly: "Plotly", d3: "d3", geo: "ZeffWorld", molecules: "$3Dmol", smiles: "SmilesDrawer", physics: "CANNON", network: "cytoscape", astronomy: "Astronomy", stats: "ss" };
  assert.deepEqual(Object.keys(WIDGET_LIBS).sort(), Object.keys(globals).sort(), "a global named for each library");
  const { page, browser, errors } = await open(`<p id="o"></p><script>document.getElementById("o").textContent = JSON.stringify(${JSON.stringify(globals)} && Object.fromEntries(Object.entries(${JSON.stringify(globals)}).map(([k, g]) => [k, typeof window[g]])))</script>`, Object.keys(globals));
  try {
    const got = JSON.parse(await page.locator("#o").innerText());
    for (const [k, v] of Object.entries(got)) assert.notEqual(v, "undefined", `${k} is there`);
    assert.equal(await page.evaluate("typeof Matter + typeof THREE.OrbitControls + typeof THREE.MarchingCubes + typeof topojson"), "objectfunctionfunctionobject");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("the science kit computes; mathjs and Algebrite answer", { skip: !CHROME && "no Chrome", timeout: 120000 }, async () => {
  const { page, browser, errors } = await open("<p>x</p>", ["mathjs", "algebrite"]);
  try {
    const r = (await page.evaluate(`(() => {
      const K = ZeffKit;
      const decay = K.ode((t, y) => -y, 1, [0, 1], { steps: 200 });
      const osc = K.ode((t, y) => [y[1], -y[0]], [0, 1], [0, Math.PI], { tol: 1e-9 });
      return {
        decay: decay.y[decay.y.length - 1],
        osc: osc.y[osc.y.length - 1][0],
        integral: K.integrate(Math.sin, 0, Math.PI),
        root: K.root((x) => x * x - 2, 0, 2),
        min: K.minimize((x) => (x - 3) ** 2, 0, 10),
        fit: K.fit([[0, 1], [1, 3], [2, 5]], 1).coef,
        color: K.colormap("viridis", 0),
        unit: math.evaluate("60 mi/h to m/s").toNumber("m/s"),
        det: math.det([[1, 2], [3, 4]]),
        integralCas: Algebrite.run("integral(x^2,x)").toString(),
        roots: Algebrite.run("roots(x^2-5x+6)").toString(),
      };
    })()`)) as Record<string, unknown>;
    assert.ok(Math.abs((r.decay as number) - Math.exp(-1)) < 1e-6, "y' = −y");
    assert.ok(Math.abs(r.osc as number) < 1e-6, "sin(π) by the adaptive solver");
    assert.ok(Math.abs((r.integral as number) - 2) < 1e-9);
    assert.ok(Math.abs((r.root as number) - Math.SQRT2) < 1e-10);
    assert.ok(Math.abs((r.min as number) - 3) < 1e-6);
    assert.deepEqual((r.fit as number[]).map((x) => Math.round(x * 1e6) / 1e6), [1, 2]);
    assert.equal(r.color, "rgb(68,1,84)");
    assert.ok(Math.abs((r.unit as number) - 26.8224) < 1e-4);
    assert.equal(r.det, -2);
    assert.match(String(r.integralCas), /1\/3\s*\*?\s*x\^3/);
    assert.match(String(r.roots), /\[2,3\]/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("a three.js scene with an iso-surface — a brain with folds — renders", { skip: !CHROME && "no Chrome", timeout: 180000 }, async () => {
  const html = `<div id="v"></div><p id="o"></p><script>
    const s = ZeffKit.scene("#v", { height: 300, camera: [0, 0.6, 3.4], background: "#ffffff" });
    const N = new THREE.SimplexNoise();
    const brain = ZeffKit.isosurface((x, y, z) => {
      const h = (cx) => 1 - ((x - cx) ** 2 / 0.42 + y ** 2 / 0.55 + z ** 2 / 0.9);
      return Math.max(h(-0.36), h(0.36)) + 0.07 * N.noise3d(x * 7, y * 7, z * 7) - (Math.abs(x) < 0.03 ? 0.4 : 0);
    }, { resolution: 56, bounds: 1.2, color: 0xe9a3a3 });
    s.add(brain);
    s.label(brain, "Cortex", [0, 0.75, 0]);
    setTimeout(() => {
      const gl = s.renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      document.getElementById("o").textContent = JSON.stringify({ tris: brain.geometry.drawRange.count, px: Array.from(px) });
    }, 1500);
  </script>`;
  const { page, browser, errors } = await open(html, ["three"]);
  try {
    await page.locator("#o", { hasText: "tris" }).waitFor({ timeout: 60000 });
    const o = JSON.parse(await page.locator("#o").innerText());
    assert.ok(o.tris > 5000, `a surface with many triangles (${o.tris})`);
    assert.ok(o.px[0] < 240 && o.px[0] > o.px[2] && o.px[0] > o.px[1], `the middle is the shaded pinkish brain, not the white background: ${o.px}`);
    assert.equal(await page.locator("text=Cortex").count(), 1, "the label");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("ZeffKit.alpha: a question in words, the AI says what to compute, the frame computes it", { skip: !CHROME && "no Chrome", timeout: 120000 }, async () => {
  // The page plays Zeff: the AI's answer to the question (what to compute — never the result).
  const host = `window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.zeffWidget !== 1 || m.type !== "call" || m.method !== "ai") return;
    window.postMessage({ zeffHost: 1, type: "reply", id: m.id, ok: true, value: { interpretation: "∫ x² sin x dx", steps: [
      { title: "Indefinite integral", algebrite: "integral(x^2*sin(x),x)" },
      { title: "From 0 to π", mathjs: "2*pi^2 - 4 + 0" },
      { title: "Unit", mathjs: "60 mi/h to km/h" },
      { title: "Broken", algebrite: "nonsense((" }
    ] } }, "*");
  });`;
  const { page, browser, errors } = await open('<div id="a"></div><script>ZeffKit.alpha("#a")</script>', ["mathjs", "algebrite", "katex"], host);
  try {
    await page.locator("input").fill("integrate x^2 sin x");
    await page.locator("button[type=submit]").click();
    await page.locator(".zk-pod").nth(3).waitFor();
    const titles = await page.locator(".zk-pod h4").allInnerTexts();
    assert.deepEqual(titles, ["Input", "Indefinite integral", "From 0 to π", "Unit", "Broken"]);
    assert.equal(await page.locator(".zk-pod").nth(1).locator(".katex").count(), 1, "the integral as a formula (Algebrite → TeX → KaTeX)");
    assert.match(await page.locator(".zk-pod").nth(2).innerText(), /15\.739/);
    assert.match(await page.locator(".zk-pod").nth(3).innerText(), /96\.56/);
    assert.ok(await page.locator(".zk-pod").nth(4).locator(".zk-err").count(), "a step that fails says so; the others stand");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
