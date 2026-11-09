import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The exercise kit (src/lib/widgets/kit/kit.js — plain browser JS; in Node it exports its pure parts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kit = createRequire(import.meta.url)("../src/lib/widgets/kit/kit.js") as any;

test("numbers as people type them: a decimal comma, a unit, a fraction, a minus sign; tolerance and units converted", () => {
  assert.deepEqual(kit.check.parseNumber("3,5 cm"), { value: 3.5, unit: "cm" });
  assert.equal(kit.check.parseNumber("3/4").value, 0.75);
  assert.equal(kit.check.number("−2", { answer: -2 }).ok, true);
  assert.equal(kit.check.number("9,8", { answer: 9.81, tol: 0.05 }).ok, true);
  assert.equal(kit.check.number("9,7", { answer: 9.81, tol: 0.05 }).ok, false);
  assert.equal(kit.check.number("9,7", { answer: 9.81, tol: 0.05 }).close, true, "near: 'almost'");
  assert.equal(kit.check.number("102", { answer: 100, rel: 0.02 }).ok, true);
  assert.equal(kit.check.number("250 cm", { answer: 2.5, unit: "m", units: { cm: 0.01 } }).ok, true, "converted");
  assert.equal(kit.check.number("250 kg", { answer: 2.5, unit: "m", units: { cm: 0.01 } }).unitWrong, true);
  assert.equal(kit.check.number("2.5", { answer: 2.5, unit: "m" }).note, "unitMissing", "right, but say the unit");
  assert.equal(kit.check.number("", { answer: 1 }).empty, true);
});

test("text the way people mean it: case, accents, one typo; keywords; patterns", () => {
  assert.equal(kit.check.text("  photosynthese. ", { answer: "Photosynthese" }).ok, true);
  assert.equal(kit.check.text("Fotosyntese", { answer: "Fotosynthese" }).ok, true, "one typo in a long word");
  assert.equal(kit.check.text("Strasse", { answer: "Straße" }).ok, true);
  assert.equal(kit.check.text("Zelle", { answer: ["Zelle", "Zellen"] }).ok, true);
  assert.equal(kit.check.text("Ast", { answer: "Ost" }).ok, false, "short words: exact");
  const kw = kit.check.text("Licht wird in Zucker umgewandelt", { answer: ["Licht", "Zucker", "CO2"], match: "keywords" });
  assert.equal(kw.ok, false);
  assert.deepEqual(kw.missing, ["CO2"]);
  assert.equal(kit.check.text("H2O", { answer: "^h2o$", match: "regex" }).ok, true);
  assert.equal(kit.check.text("x", { answer: "(", match: "regex" }).ok, false, "a broken pattern doesn't throw");
});

test("formulas compared as functions, not as text — read safely (no eval), what can't be read said", () => {
  assert.equal(kit.check.formula("cos(x^2)*2x", { answer: "2*x*cos(x^2)" }).ok, true);
  assert.equal(kit.check.formula("2 x cos(x²)".replace("²", "^2"), { answer: "2*x*cos(x^2)" }).ok, true, "implicit products");
  assert.equal(kit.check.formula("x^2", { answer: "2*x*cos(x^2)" }).ok, false);
  assert.equal(kit.check.formula("v*t + a*t^2/2", { answer: "a/2*t^2 + v t", vars: ["a", "v", "t"] }).ok, true);
  assert.equal(kit.check.formula("sqrt(x^2)", { answer: "abs(x)" }).ok, true);
  assert.ok(kit.check.formula("2x +", { answer: "x" }).error, "incomplete: said");
  assert.ok(kit.check.formula("alert(1)", { answer: "x" }).error, "unknown names aren't run");
  assert.equal(kit.expr("a*x^2", ["a", "x"])({ a: 2, x: 3 }), 18);
  assert.equal(kit.expr("-2^2", [])({}), -4, "minus binds weaker than the power");
});

test("cloze: blanks with alternatives and choices with the right one marked", () => {
  assert.deepEqual(kit.check.parseCloze("A {{b|c}} D {{[x|*y|z]}}."), [
    { text: "A " },
    { blank: true, answers: ["b", "c"] },
    { text: " D " },
    { blank: true, options: ["x", "y", "z"], answer: 1 },
    { text: "." },
  ]);
  assert.equal(kit.TYPES.length, 15);
});

test("an exercise set checked: each mistake said with its item, so the teacher can fix it at once", async () => {
  const { checkSpec, specHtml, specHasMath } = await import("@/lib/widgets/spec");
  assert.deepEqual(checkSpec({ items: [{ type: "choice", q: "?", options: ["a", "b"], answer: 1 }] }), []);
  const problems = checkSpec({
    items: [
      { type: "choice", q: "?", options: ["a", "b"], answer: 2 },
      { type: "number", q: "?", answer: "9.81" },
      { type: "nope", q: "?" },
      { type: "scenario", nodes: { start: { text: "Du", choices: [{ label: "x", to: "nirgends" }] } } },
      { type: "hotspot", q: "?", image: "https://example.com/a.png", spots: [] },
      { type: "cloze", text: "no blanks" },
      { type: "text", q: "?", answer: "(", match: "regex" },
    ],
  });
  assert.equal(problems.length, 7, problems.join("\n"));
  assert.match(problems[0], /^item 1 \(choice\): answer/);
  assert.match(problems[1], /^item 2 \(number\): answer: a number/);
  assert.match(problems[2], /unknown type "nope"/);
  assert.match(problems[3], /leads to "nirgends"/);
  assert.match(problems[4], /data:image/);
  assert.deepEqual(checkSpec({}), ["items: at least one"]);
  // As HTML: the JSON can't end its tag early; math gets KaTeX.
  const html = specHtml({ title: "T", items: [{ type: "text", q: "</script><b>", answer: "x" }] });
  assert.ok(!html.includes("</script><b>"));
  assert.equal(specHasMath({ items: [{ type: "text", q: "Was ist $x^2$?", answer: "x" }] }), true);
});

test("learn_widget: a set with mistakes is refused with each of them; a good one is shown (with KaTeX for its math)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  const store = await import("@/plugins/learn/store");
  const { learnWidget } = await import("@/plugins/learn/tools");
  const c = { id: store.createCourse({ topic: "Physik", goal: "", level: "" }) };
  store.savePlan(c.id, { title: "Physik", summary: "", years: 1, sources: [], nodes: [{ key: "s1", kind: "step", parent: null, title: "Fallgesetz" }] });
  assert.throws(() => learnWidget({ course_id: c.id, node_key: "s1", title: "Fall", spec: { items: [{ type: "number", q: "g?", answer: "viel" }] } }), /item 1 \(number\): answer: a number/);
  const out = learnWidget({ course_id: c.id, node_key: "s1", title: "Fall", spec: { items: [{ type: "number", q: "Wie groß ist $g$?", answer: 9.81, tol: 0.05, unit: "m/s^2" }] } });
  assert.match(out, /Widget #\d+ is shown/);
  const w = store.nodeWidgets(c.id, "s1")[0];
  assert.ok(w.html.includes("ZeffKit.mount"));
  assert.deepEqual(w.libs, ["katex"]);
  assert.throws(() => learnWidget({ course_id: c.id, node_key: "s1", title: "x" }), /spec .* or html/);
});

test("a widget's error message comes through the bridge, checked", async () => {
  const { parseWidgetMessage, buildSrcdoc } = await import("@/lib/widgets/sandbox");
  assert.deepEqual(parseWidgetMessage({ zeffWidget: 1, type: "error", message: "x is not defined" }), { type: "error", message: "x is not defined" });
  assert.equal(parseWidgetMessage({ zeffWidget: 1, type: "error", message: "" }), null);
  const doc = buildSrcdoc("<p>hi</p>", { inline: { js: [], css: [] }, lang: "en" });
  assert.match(doc, /<html lang="en">/);
  assert.match(doc, /worker-src blob:/);
  assert.match(doc, /unhandledrejection/);
});
