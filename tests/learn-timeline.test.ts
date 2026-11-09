import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline } from "../src/plugins/learn/timeline";
import type { WorkLogLine } from "../src/lib/work/shared";

const say = (text: string): WorkLogLine => ({ k: "say", text });
const you = (text: string): WorkLogLine => ({ k: "you", text });
const tool = (name: string): WorkLogLine => ({ k: "tool", tool: name, text: "" });

test("a lesson as a timeline: your words and exercises left, the teacher's right, in the order they happened", () => {
  const items = buildTimeline({
    runs: [
      {
        id: 1,
        startedAt: "2026-11-09T10:00:00.000Z",
        prompts: ["Lass uns anfangen: „Vektorräume“."],
        lines: [
          { k: "start", text: "sonnet" },
          say("Was ist ein Vektor?"),
          tool("zeff__learn_context"),
          tool("zeff__learn_widget"),
          say("Löse die Übung links."),
          you("[Übung „Abhängig?“ abgeschlossen: 4 von 5 richtig, 80 %.] Besprich kurz …"),
          say("Fast alles richtig!"),
          you("Und warum ist (1,1) unabhängig?"),
          say("Weil …"),
          tool("zeff__learn_master_step"),
        ],
      },
    ],
    widgets: [{ id: 7, title: "Abhängig?", createdAt: "2026-11-09T10:01:00.000Z" }],
    results: [{ at: "2026-11-09T10:03:00.000Z", widget: 7, score: 0.8, correct: 4, total: 5, answers: [{ q: "(1,0),(0,1)", a: "unabhängig", ok: true }] }],
  });
  assert.deepEqual(
    items.map((i) => `${i.side}:${i.kind}`),
    ["center:session", "left:you", "right:say", "left:widget", "right:say", "left:result", "right:say", "left:you", "right:say", "center:mastered"],
  );
  const result = items.find((i) => i.kind === "result")!;
  assert.equal(result.kind === "result" && result.answers?.[0].a, "unabhängig", "the answers from the result kept with it");
  assert.equal(result.kind === "result" && result.title, "Abhängig?");
  assert.equal(items.find((i) => i.kind === "widget")!.kind === "widget" && (items.find((i) => i.kind === "widget") as { widgetId: number }).widgetId, 7);
});

test("results without a message (before the lesson went on by itself) land after the session they happened in; widgets nobody announced at the end", () => {
  const items = buildTimeline({
    runs: [
      { id: 1, startedAt: "2026-11-09T10:00:00.000Z", prompts: [], lines: [say("eins")] },
      { id: 2, startedAt: "2026-11-09T12:00:00.000Z", prompts: ["weiter"], lines: [say("zwei")] },
    ],
    widgets: [{ id: 3, title: "W", createdAt: "2026-11-09T10:30:00.000Z" }],
    results: [{ at: "2026-11-09T10:40:00.000Z", widget: 3, score: 1 }],
  });
  assert.deepEqual(
    items.map((i) => `${i.side}:${i.kind}`),
    ["center:session", "right:say", "left:result", "center:session", "left:you", "right:say", "left:widget"],
  );
});

test("a result message whose result isn't recorded still shows what it says", () => {
  const items = buildTimeline({ runs: [{ id: 1, startedAt: "2026-11-09T10:00:00.000Z", prompts: [], lines: [you("[Übung „X“ abgeschlossen: 2 von 4 richtig, 50 %.] Besprich …")] }], widgets: [], results: [] });
  const r = items.find((i) => i.kind === "result");
  assert.ok(r && r.kind === "result");
  assert.equal(r.title, "X");
  assert.equal(r.score, 0.5);
  assert.deepEqual([r.correct, r.total], [2, 4]);
});

test("messages queued for one run are each their own — an exercise's result among them a result", () => {
  const items = buildTimeline({
    runs: [{ id: 1, startedAt: "2026-11-09T10:00:00.000Z", prompts: ["Geht es wieder?", "[Übung „Q“ abgeschlossen: 4 von 5 richtig, 80 %.] Besprich …"], lines: [say("Ja.")] }],
    widgets: [{ id: 2, title: "Q", createdAt: "2026-11-09T09:00:00.000Z" }],
    results: [{ at: "2026-11-09T09:59:00.000Z", widget: 2, score: 0.8, correct: 4, total: 5 }],
  });
  assert.deepEqual(items.map((i) => `${i.side}:${i.kind}`), ["center:session", "left:you", "left:result", "right:say", "left:widget"]);
});

test("the same exercise done twice: each message gets the try whose numbers it names", () => {
  const items = buildTimeline({
    runs: [{ id: 1, startedAt: "2026-11-09T10:00:00.000Z", prompts: [], lines: [you("[Übung „Q“ abgeschlossen: 5 von 5 richtig, 100 %.] …")] }],
    widgets: [{ id: 2, title: "Q", createdAt: "2026-11-09T09:00:00.000Z" }],
    results: [
      { at: "2026-11-09T10:01:00.000Z", widget: 2, score: 0.8, correct: 4, total: 5 },
      { at: "2026-11-09T10:02:00.000Z", widget: 2, score: 1, correct: 5, total: 5 },
    ],
  });
  const res = items.filter((i) => i.kind === "result") as { correct?: number; at: string | null }[];
  assert.deepEqual(res.map((r) => [r.correct, r.at]), [[5, "2026-11-09T10:02:00.000Z"], [4, "2026-11-09T10:01:00.000Z"]]);
});

test("a try's snapshot goes along to its result on the timeline", () => {
  const items = buildTimeline({ runs: [], widgets: [{ id: 1, title: "W", createdAt: "2026-11-09T09:00:00.000Z" }], results: [{ at: "2026-11-09T10:00:00.000Z", widget: 1, score: 1, snapshotId: 7 }] });
  const r = items.find((i) => i.kind === "result") as { snapshotId?: number };
  assert.equal(r.snapshotId, 7);
});
