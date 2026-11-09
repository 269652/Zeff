import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * The exercise kit in a real browser (Chrome, headless — skipped when it isn't installed): every item type rendered from
 * one set as the teacher writes it, answered by tapping and typing, the report at the end (score, answers, done); a
 * broken item skipped with a note; an error in a widget of its own reported and shown.
 */
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

const SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#eee"/><circle cx="50" cy="20" r="12" fill="green"/><rect x="45" y="35" width="10" height="60" fill="brown"/></svg>`;

const SET = {
  title: "Alles auf einmal",
  lang: "de",
  items: [
    { type: "choice", q: "Kleinste Einheit des Lebens?", options: ["Atom", "Zelle", "Organ"], answer: 1 },
    { type: "number", q: "Fallbeschleunigung?", answer: 9.81, tol: 0.05, unit: "m/s^2" },
    { type: "text", q: "Wie heißt der Prozess?", answer: "Photosynthese" },
    { type: "formula", q: "Ableitung von sin(x^2)?", answer: "2*x*cos(x^2)" },
    { type: "cloze", text: "Die {{Eiche}} ist ein {{[Nadelbaum|*Laubbaum]}}." },
    { type: "order", q: "Reihenfolge?", items: ["Aushub", "Fundament", "Wände"] },
    { type: "match", q: "Zuordnen", pairs: [["Eiche", "Quercus"], ["Buche", "Fagus"]] },
    { type: "categorize", q: "Sortieren", groups: { Laub: ["Eiche"], Nadel: ["Fichte"] } },
    { type: "hotspot", q: "Baum", image: SVG, spots: [{ label: "Krone", x: 50, y: 20, r: 15 }] },
    { type: "slider", q: "Schätze", min: 0, max: 100, answer: 50, tol: 5 },
    { type: "code", q: "add", starter: "function add(a, b) { return a + b; }", tests: [{ call: "add(2, 3)", expect: 5 }] },
    { type: "table", q: "Ausfüllen", columns: ["x", "x²"], rows: [["2", { answer: 4 }]] },
    { type: "plot", q: "Kurve", fn: "a*x", params: { a: { min: 0, max: 4, value: 2 } }, target: { a: 2 } },
    { type: "scenario", q: "Situation", nodes: { start: { text: "Ein Kind weint.", choices: [{ label: "Hingehen", to: "gut" }] }, gut: { text: "Gut gemacht.", end: true, score: 1 } } },
    { type: "cards", q: "Karten", cards: [{ front: "Vorne", back: "Hinten" }] },
    { type: "nonsense", q: "kaputt" },
  ],
};

test("every item type in a real browser: answered, the report at the end — a broken item skipped", { skip: !CHROME && "no Chrome" }, async () => {
  const { chromium } = await import("playwright-core");
  const { buildSrcdoc } = await import("@/lib/widgets/sandbox");
  const { specHtml } = await import("@/lib/widgets/spec");
  const { libBundle } = await import("@/lib/widgets/libs");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      (window as unknown as { msgs: unknown[] }).msgs = [];
      window.addEventListener("message", (e) => (window as unknown as { msgs: unknown[] }).msgs.push(e.data));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = buildSrcdoc(specHtml(SET as any), { inline: libBundle(["katex"]), lang: "de" });
    await page.route("http://kit.test/", (r) => r.fulfill({ contentType: "text/html", body: doc }));
    await page.goto("http://kit.test/");
    const next = () => page.locator(".zk button.zk-btn.pri:visible", { hasText: /Weiter|Fertig/ }).last().click();
    const check = () => page.locator(".zk button.zk-btn.pri:visible", { hasText: /Prüfen|Ausführen|Fertig/ }).first().click();

    await page.getByRole("button", { name: "Zelle" }).click(); // instant
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator(".zk-in").fill("9,81 m/s^2");
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator(".zk-in").fill("photosynthese");
    await page.locator(".zk-in").press("Enter");
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator("input.zk-in").fill("cos(x^2)*2x");
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator("input.zk-in").fill("Eiche");
    await page.locator("select.zk-in").selectOption({ label: "Laubbaum" });
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    // order: mixed — two wrong tries, then the answer is shown
    await check();
    if (!(await page.locator(".zk-fb.ok").count())) {
      await check();
    }
    await page.locator(".zk-fb.ok, .zk-fb.bad").first().waitFor();
    await next();
    await page.locator("select.zk-in").nth(0).selectOption("Quercus");
    await page.locator("select.zk-in").nth(1).selectOption("Fagus");
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator(".zk-chip", { hasText: "Eiche" }).click();
    await page.locator(".zk-group", { hasText: "Laub" }).first().click();
    await page.locator(".zk-chip", { hasText: "Fichte" }).click();
    await page.locator(".zk-group", { hasText: "Nadel" }).click();
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    const spot = page.locator(".zk-spot");
    const box = (await spot.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2); // the crown
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator("input[type=range]").fill("50");
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await check(); // code: run the tests in a worker
    await page.locator(".zk-fb.ok").waitFor({ timeout: 5000 });
    await next();
    await page.locator("table input").fill("4");
    await check();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await check(); // plot already on target
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.getByRole("button", { name: "Hingehen" }).click();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    await page.locator(".zk-card").click();
    await page.getByRole("button", { name: "Wusste ich", exact: true }).click();
    await page.locator(".zk-fb.ok").waitFor();
    await next();
    // the broken one: a note, skipped
    await page.locator(".zk-broken").waitFor();
    await page.locator(".zk button.zk-btn.pri", { hasText: "Weiter" }).click();
    await page.locator(".zk-sum").waitFor();

    const msgs = (await page.evaluate(() => (window as unknown as { msgs: Record<string, unknown>[] }).msgs)).filter((m) => m.zeffWidget === 1);
    const result = msgs.find((m) => m.type === "result") as { score: number; total: number; correct: number; done: boolean; answers: { q: string; a: string; ok?: boolean }[]; snapshot?: string };
    assert.ok(result, JSON.stringify(msgs.map((m) => m.type)));
    assert.equal(result.done, true);
    assert.equal(result.answers.length, 16);
    assert.ok(result.correct >= 13, `correct ${result.correct} of ${result.total}`);
    assert.ok(result.score > 0.85, String(result.score));
    assert.match(result.answers[15].a, /skipped/);
    assert.ok(result.snapshot && result.snapshot.includes("zk-sum"), "a snapshot of the summary");
    assert.ok(msgs.some((m) => m.type === "error" && /nonsense/.test(String(m.message))), "the broken item was told");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("a widget of its own that throws: a friendly note in it, the error told to the page", { skip: !CHROME && "no Chrome" }, async () => {
  const { chromium } = await import("playwright-core");
  const { buildSrcdoc } = await import("@/lib/widgets/sandbox");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as unknown as { msgs: unknown[] }).msgs = [];
      window.addEventListener("message", (e) => (window as unknown as { msgs: unknown[] }).msgs.push(e.data));
    });
    const doc = buildSrcdoc(`<p>Simulation</p><script>window.addEventListener("load", function () { undefinedThing(); });</script>`, { inline: { js: [], css: [] }, lang: "de" });
    await page.route("http://kit.test/", (r) => r.fulfill({ contentType: "text/html", body: doc }));
    await page.goto("http://kit.test/");
    await page.locator("#zeff-widget-error").waitFor();
    assert.match(await page.locator("#zeff-widget-error").innerText(), /Lehrer weiß Bescheid/);
    const msgs = await page.evaluate(() => (window as unknown as { msgs: Record<string, unknown>[] }).msgs);
    assert.ok(msgs.some((m) => m.type === "error" && /undefinedThing/.test(String(m.message))));
    assert.ok(await page.locator("p", { hasText: "Simulation" }).isVisible(), "what works stays");
  } finally {
    await browser.close();
  }
});
