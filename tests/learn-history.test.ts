import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("the next lesson's teacher knows what the person showed in the course's other lessons — not this one's", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "Psychiatrie", goal: "", level: "" });
  store.savePlan(id, { title: "Psychiatrie", summary: "", years: 1, sources: [], nodes: [{ key: "a", kind: "step", parent: null, title: "Hirnlappen" }, { key: "b", kind: "step", parent: null, title: "Limbisches System" }] });
  const w = store.addWidget({ courseId: id, nodeKey: "a", title: "Quiz", html: "<p>q</p>" });
  store.widgetResult(w, { type: "result", score: 1, correct: 2, total: 2, note: "Limbisches System", answers: [{ q: "Neues merken geht nicht — was ist geschädigt?", a: "Hippocampus", ok: true }] });
  store.masterNode(id, "a", new Date(), "5 von 6 richtig");
  const lines = store.courseHistory(id, "b");
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /Übung in „Hirnlappen“ \(Limbisches System\): 100 % \(2\/2\) — Neues merken .* → Hippocampus ✓/);
  assert.match(lines[1], /Einheit „Hirnlappen“ gemeistert: 5 von 6 richtig/);
  assert.deepEqual(store.courseHistory(id, "a"), [], "its own lesson's things aren't repeated");
  const { teacherRules } = await import("@/plugins/learn/teacher");
  assert.match(teacherRules(store.getCourse(id)!, store.getNode(id, "b")!), /schon gezeigt hat[\s\S]*Hippocampus ✓/);
});
