import assert from "node:assert/strict";
import test from "node:test";
import { buildSrcdoc, parseWidgetMessage, xpForResult, WIDGET_LIBS, checkWidgetHtml } from "@/lib/widgets/sandbox";
import { setupTempData } from "./helpers";

// Its own throwaway database (it makes courses) — never the real data folder.
setupTempData();

test("the page a widget runs in: no network, only the shipped libraries, the bridge first", () => {
  const doc = buildSrcdoc("<div id=app></div><script>zeff.report({ score: 1 })</script>", { libs: ["katex"], libBase: "http://127.0.0.1:9333/api/widgets/lib" });
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(doc)?.[1] ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/, "no fetch, no WebSocket");
  assert.match(csp, /script-src 'unsafe-inline' http:\/\/127\.0\.0\.1:9333\/api\/widgets\/lib\//);
  assert.match(csp, /img-src data: blob:/);
  assert.match(csp, /form-action 'none'/);
  assert.ok(doc.indexOf("window.zeff") < doc.indexOf("<div id=app>"), "the bridge comes before the widget's own code");
  assert.match(doc, /\/api\/widgets\/lib\/katex\/katex\.min\.js/);
  assert.match(doc, /\/api\/widgets\/lib\/katex\/katex\.min\.css/);
});

test("only known libraries are linked", () => {
  const doc = buildSrcdoc("<p>x</p>", { libs: ["katex", "evil", "../../etc"], libBase: "/api/widgets/lib" });
  assert.ok(!/evil|etc/.test(doc.replace(/<meta[^>]+>/, "")));
  assert.ok(WIDGET_LIBS.katex);
});

test("a widget's html: size limited, no <base>, no meta refresh, no own CSP to weaken ours", () => {
  assert.equal(checkWidgetHtml("<p>hi</p>").ok, true);
  assert.equal(checkWidgetHtml("x".repeat(300_001)).ok, false);
  for (const bad of ['<base href="https://evil.example/">', '<meta http-equiv="refresh" content="0;url=https://evil.example">', '<meta http-equiv="Content-Security-Policy" content="default-src *">']) {
    const r = checkWidgetHtml(`<p>x</p>${bad}`);
    assert.equal(r.ok, false, bad);
  }
});

test("messages from a widget: a result is read, clamped and checked — anything else is ignored", () => {
  assert.deepEqual(parseWidgetMessage({ zeffWidget: 1, type: "result", score: 0.75, correct: 3, total: 4, note: "Ableitung sitzt" }), {
    type: "result",
    score: 0.75,
    correct: 3,
    total: 4,
    note: "Ableitung sitzt",
  });
  assert.equal((parseWidgetMessage({ zeffWidget: 1, type: "result", score: 7 }) as { score?: number } | null)?.score, 1, "clamped to 1");
  assert.equal((parseWidgetMessage({ zeffWidget: 1, type: "result", correct: 2, total: 4 }) as { score?: number } | null)?.score, 0.5, "the score from correct/total");
  assert.equal(parseWidgetMessage({ zeffWidget: 1, type: "result" }), null, "no score at all");
  assert.equal(parseWidgetMessage({ type: "result", score: 1 }), null, "not ours");
  assert.equal(parseWidgetMessage("result"), null);
  assert.deepEqual(parseWidgetMessage({ zeffWidget: 1, type: "resize", height: 640 }), { type: "resize", height: 640 });
  assert.equal((parseWidgetMessage({ zeffWidget: 1, type: "resize", height: 99999 }) as { height?: number } | null)?.height, 4000, "capped");
  const long = parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, note: "n".repeat(5000) });
  assert.equal(long?.type === "result" && long.note?.length, 500);
});

test("xp for a widget's result: a few points, more for a better score, none for nothing right", () => {
  assert.equal(xpForResult({ type: "result", score: 0 }), 0);
  assert.equal(xpForResult({ type: "result", score: 1 }), 5);
  assert.ok(xpForResult({ type: "result", score: 0.5 }) >= 2 && xpForResult({ type: "result", score: 0.5 }) <= 3);
});

test("inline: the libraries' code put into the page itself (a sandboxed frame loads nothing — on the phone it couldn't reach Zeff)", () => {
  const doc = buildSrcdoc("<p id=x></p>", { inline: { js: ["window.LIB=1;"], css: [".k{color:red}"] } });
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(doc)?.[1] ?? "";
  assert.match(csp, /script-src 'unsafe-inline';/);
  assert.match(csp, /font-src data:/);
  assert.ok(!/https?:/.test(csp), "nothing to load from anywhere");
  assert.ok(doc.includes("window.LIB=1;"));
  assert.ok(doc.includes(".k{color:red}"));
  assert.ok(doc.indexOf("window.zeff") < doc.indexOf("window.LIB=1;"), "the bridge first");
  const evil = buildSrcdoc("<p></p>", { inline: { js: ["</script><script>alert(1)"], css: ["</style><script>x</script>"] } });
  assert.ok(!evil.includes("</script><script>alert(1)"), "a library's text can't close its tag");
});

test("a widget may say it's done (the lesson goes on then); only true counts", async () => {
  const { parseWidgetMessage } = await import("@/lib/widgets/sandbox");
  assert.equal((parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, done: true }) as { done?: boolean }).done, true);
  assert.equal("done" in (parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, done: "yes" }) as object), false);
});

test("a result as the message to the teacher: the exercise, how it went, the note — and to go on", async () => {
  const { resultMessage } = await import("@/plugins/learn/result-message");
  const m = resultMessage("Abhängig oder unabhängig?", { type: "result", score: 0.8, correct: 4, total: 5, note: "Paar 3 falsch" });
  assert.match(m, /Abhängig oder unabhängig\?/);
  assert.match(m, /4 von 5 richtig/);
  assert.match(m, /80 %/);
  assert.match(m, /Paar 3 falsch/);
  assert.match(m, /weiter/);
  assert.doesNotMatch(resultMessage("X", { type: "result", score: 0.5 }), /\d von \d/, "no count without one");
});

test("a result may carry the answers (question, your answer, right or not) — checked and capped", async () => {
  const { parseWidgetMessage } = await import("@/lib/widgets/sandbox");
  const r = parseWidgetMessage({ zeffWidget: 1, type: "result", score: 0.5, answers: [{ q: "2+2", a: "4", ok: true }, { q: "3·3", a: "6", ok: false }, { q: "x", a: 5 }, "nonsense"] }) as { answers?: unknown[] };
  assert.deepEqual(r.answers, [{ q: "2+2", a: "4", ok: true }, { q: "3·3", a: "6", ok: false }, { q: "x", a: "5" }]);
  const many = parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, answers: Array.from({ length: 80 }, (_, i) => ({ q: `q${i}`, a: "a".repeat(900) })) }) as { answers: { a: string }[] };
  assert.equal(many.answers.length, 50);
  assert.equal(many.answers[0].a.length, 300);
});

test("the teacher's message lists the answers, the wrong ones marked", async () => {
  const { resultMessage } = await import("@/plugins/learn/result-message");
  const m = resultMessage("Rechnen", { type: "result", score: 0.5, correct: 1, total: 2, answers: [{ q: "2+2", a: "4", ok: true }, { q: "3·3", a: "6", ok: false }] });
  assert.match(m, /2\+2 → 4 ✓/);
  assert.match(m, /3·3 → 6 ✗/);
});

test("a result is recorded with its answers (the lesson's timeline shows them)", async () => {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "x", goal: "", level: "" });
  store.savePlan(id, { title: "T", years: 1, nodes: [{ key: "y", kind: "year", parent: null, title: "Y" }, { key: "p", kind: "phase", parent: "y", title: "P" }, { key: "s", kind: "skill", parent: "p", title: "S" }, { key: "a", kind: "step", parent: "s", title: "A" }] });
  const w = store.addWidget({ courseId: id, nodeKey: "a", title: "Quiz", html: "<p>q</p>" });
  store.widgetResult(w, { type: "result", score: 1, answers: [{ q: "2+2", a: "4", ok: true }] });
  const ev = store.widgetResults(id, "a");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].answers, [{ q: "2+2", a: "4", ok: true }]);
  assert.equal(ev[0].widget, w);
});

test("a result may carry a snapshot of the widget as it was (its drawing, its inputs) — text, capped", async () => {
  const { parseWidgetMessage } = await import("@/lib/widgets/sandbox");
  const r = parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, snapshot: "<svg><circle r='2'/></svg>" }) as { snapshot?: string };
  assert.equal(r.snapshot, "<svg><circle r='2'/></svg>");
  const big = parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, snapshot: "x".repeat(3_000_001) }) as { snapshot?: string };
  assert.equal(big.snapshot, undefined, "too big: left out, the result still counts");
  assert.equal((parseWidgetMessage({ zeffWidget: 1, type: "result", score: 1, snapshot: 5 }) as { snapshot?: string }).snapshot, undefined);
});

test("a try's snapshot is kept with it: the timeline has its id, the snapshot its widget's libraries", async () => {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "s", goal: "", level: "" });
  store.savePlan(id, { title: "T", years: 1, nodes: [{ key: "y", kind: "year", parent: null, title: "Y" }, { key: "p", kind: "phase", parent: "y", title: "P" }, { key: "s", kind: "skill", parent: "p", title: "S" }, { key: "a", kind: "step", parent: "s", title: "A" }] });
  const w = store.addWidget({ courseId: id, nodeKey: "a", title: "Plot", html: "<div id=b></div>", libs: ["jsxgraph"] });
  store.widgetResult(w, { type: "result", score: 1, snapshot: "<div><svg><path d='M0 0L1 1'/></svg></div>" });
  store.widgetResult(w, { type: "result", score: 0.5 });
  const [first, second] = store.widgetResults(id, "a");
  assert.ok(first.snapshotId, "the first try has one");
  assert.equal(second.snapshotId, undefined, "the second none");
  const snap = store.widgetSnapshot(first.snapshotId!)!;
  assert.match(snap.html, /<path/);
  assert.deepEqual(snap.libs, ["jsxgraph"]);
  assert.equal(snap.title, "Plot");
  assert.equal(store.widgetSnapshot(999999), null);
});
