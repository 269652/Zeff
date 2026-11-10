import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

// Learn's progress must survive its move into the Workspace exactly — it was lost once before. These tests seed Learn's old
// tables as the plugin kept them (the same DDL), move them, and compare everything that is progress.
const dir = setupTempData();

/** Learn's old tables, exactly as its store made them before the move. */
const OLD_DDL = `
  create table if not exists learn_courses (id integer primary key autoincrement, topic text not null, goal text not null default '', level text not null default '', status text not null default 'researching', title text not null default '', summary text not null default '', years real not null default 0, sources text not null default '[]', problems text not null default '[]', error text, interests text not null default '{}', daily_goal integer not null default 50, xp integer not null default 0, streak integer not null default 0, last_day text, today text, today_xp integer not null default 0, badges text not null default '[]', created_at text not null, updated_at text not null, slots text not null default '[]', review_todo_id integer);
  create table if not exists learn_nodes (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, key text not null, kind text not null, parent_key text, title text not null, summary text not null default '', objectives text not null default '[]', requires text not null default '[]', path text, xp integer not null default 0, minutes integer, sources text not null default '[]', ord integer not null default 0, mastered_at text, active_since text, lesson_todo_id integer, unique (course_id, key));
  create table if not exists learn_events (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, kind text not null, xp integer not null default 0, detail text not null default '{}', at text not null);
  create table if not exists learn_snapshots (id integer primary key autoincrement, course_id integer not null, widget_id integer not null, html text not null, at text not null);
  create table if not exists learn_widgets (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, run_id integer, title text not null, html text not null, libs text not null default '[]', best_score real, xp integer not null default 0, created_at text not null);
  create table if not exists learn_cards (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, front text not null, back text not null, reps integer not null default 0, lapses integer not null default 0, ease real not null default 2.5, interval integer not null default 0, due text not null, last text, created_at text not null);
`;

const WIDGET_HTML = `<div id="q">κ = 1/r? <input id="a"></div><script>document.getElementById("a").oninput = () => zeff.report({ score: 1, done: true });</script>`;
const COURSE = { id: 11, topic: "Differentialgeometrie", goal: "Riemann", level: "Abitur", status: "ready", title: "Differential geometry", summary: "From curves to surfaces.", years: 1, sources: JSON.stringify([{ id: "s1", title: "do Carmo", year: 1976 }]), problems: "[]", error: null, interests: JSON.stringify({ Physik: 3, Anschauung: 1 }), daily_goal: 60, xp: 885, streak: 9, last_day: "2026-11-09", today: "2026-11-09", today_xp: 35, badges: JSON.stringify(["first-step", "first-skill", "streak-7"]), created_at: "2026-10-01T08:00:00.000Z", updated_at: "2026-11-09T18:40:00.000Z", slots: JSON.stringify([{ day: 1, at: "18:00", minutes: 30 }]), review_todo_id: 4242 };
const NODES = [
  { key: "y1", kind: "year", parent_key: null, title: "Year 1", xp: 500, ord: 0 },
  { key: "p1", kind: "phase", parent_key: "y1", title: "Curves", xp: 150, ord: 1 },
  { key: "a", kind: "skill", parent_key: "p1", title: "Curvature", path: "Core", xp: 50, ord: 2 },
  { key: "a1", kind: "step", parent_key: "a", title: "Arc length", xp: 10, ord: 3, mastered_at: "2026-11-05T18:12:44.123Z", objectives: JSON.stringify(["Compute a curve's length"]), sources: JSON.stringify(["s1"]) },
  { key: "a2", kind: "step", parent_key: "a", title: "Frenet frame", xp: 10, ord: 4, requires: JSON.stringify(["a1"]), active_since: "2026-11-09T18:05:10.000Z" },
  { key: "a3", kind: "step", parent_key: "a", title: "Torsion", xp: 10, ord: 5, requires: JSON.stringify(["a2"]), minutes: 25 },
];

async function seedOld() {
  const { getSqlite, getDb, schema } = await import("@/db");
  const d = getSqlite();
  d.exec(OLD_DDL);
  const cols = Object.keys(COURSE);
  d.prepare(`insert into learn_courses (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => (COURSE as Record<string, unknown>)[c] as never));
  d.prepare("insert into learn_courses (id, topic, goal, level, status, created_at, updated_at) values (12, 'Französisch', 'B2', 'A1', 'researching', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')").run();
  // The lesson of a2: its todo and a run whose log has the talk.
  const now = new Date().toISOString();
  const { LEARN_SOURCE } = await import("@/plugins/learn/teacher");
  const todoId = getDb().insert(schema.todos).values({ ticket: "", text: "Lernen: Frenet frame", kind: "other", owner: "me", status: "open", source: LEARN_SOURCE, refs: "[]", runId: null, byWorker: true, createdAt: now, updatedAt: now }).returning({ id: schema.todos.id }).get().id;
  for (const n of NODES) {
    const v = { course_id: 11, summary: "", objectives: "[]", requires: "[]", path: null, minutes: null, sources: "[]", mastered_at: null, active_since: null, lesson_todo_id: n.key === "a2" ? todoId : null, ...n };
    const c = Object.keys(v);
    d.prepare(`insert into learn_nodes (${c.join(", ")}) values (${c.map(() => "?").join(", ")})`).run(...c.map((k) => (v as Record<string, unknown>)[k] as never));
  }
  d.prepare("insert into learn_widgets (id, course_id, node_key, run_id, title, html, libs, best_score, xp, created_at) values (5, 11, 'a2', null, 'Curvature of circles', ?, '[\"katex\"]', 0.75, 3, '2026-11-09T18:10:00.000Z')").run(WIDGET_HTML);
  d.prepare("insert into learn_snapshots (id, course_id, widget_id, html, at) values (1, 11, 5, '<div>as it looked</div>', '2026-11-09T18:12:00.000Z')").run();
  d.prepare("insert into learn_cards (id, course_id, node_key, front, back, reps, lapses, ease, interval, due, last, created_at) values (9, 11, 'a1', 'Arc length of γ?', '∫|γ′|', 2, 1, 2.36, 6, '2026-11-14T08:30:12.000Z', '2026-11-08T08:30:12.000Z', '2026-11-05T18:20:00.000Z')").run();
  d.prepare("insert into learn_cards (id, course_id, node_key, front, back, reps, lapses, ease, interval, due, last, created_at) values (10, 11, 'a1', 'Unit speed?', '‖γ′‖ = 1', 0, 0, 2.5, 0, '2026-11-05T18:20:00.000Z', null, '2026-11-05T18:20:00.000Z')").run();
  d.prepare("insert into learn_events (id, course_id, node_key, kind, xp, detail, at) values (1, 11, 'a1', 'mastered', 10, ?, '2026-11-05T18:12:44.123Z')").run(JSON.stringify({ keys: ["a1"], note: "computed it twice" }));
  d.prepare("insert into learn_events (id, course_id, node_key, kind, xp, detail, at) values (2, 11, 'a2', 'widget', 3, ?, '2026-11-09T18:12:00.000Z')").run(JSON.stringify({ widget: 5, score: 0.75, correct: 3, total: 4, answers: [{ q: "r = 2", a: "0.5", ok: true }, { q: "line", a: "1", ok: false }], snapshot: 1 }));
  d.prepare("insert into learn_events (id, course_id, node_key, kind, xp, detail, at) values (3, 11, 'a1', 'review', 1, ?, '2026-11-08T08:30:12.000Z')").run(JSON.stringify({ card: 9, grade: "good" }));
  const { createRun, updateRun } = await import("@/lib/work/store");
  const { logPath } = await import("@/lib/work/log");
  const { addTodoInstruction } = await import("@/lib/todos/store");
  const run = createRun({ ticket: "", todoId, mode: "instruct", provider: "claude", model: "sonnet", permissionMode: "default", repo: null, prompt: "Los geht's." });
  updateRun(run.id, { status: "done", startedAt: "2026-11-09T18:05:00.000Z", finishedAt: "2026-11-09T18:30:00.000Z" });
  addTodoInstruction(todoId, "Los geht's: „Frenet frame“.", run.id);
  const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
  const lines = [{ type: "user", isReplay: true, message: { content: "Los geht's" } }, say("Das Frenet-Dreibein besteht aus T, N und B."), { type: "assistant", message: { content: [{ type: "tool_use", id: "w", name: "mcp__zeff__learn_widget", input: {} }] } }, { type: "user", isReplay: true, message: { content: "Warum ist N senkrecht zu T?" } }, say("Weil |T| = 1 ist.")];
  fs.mkdirSync(path.dirname(logPath(run.id)), { recursive: true });
  fs.writeFileSync(logPath(run.id), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { todoId };
}

const minute = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 60000) : null);
const counts = async () => {
  const { getSqlite } = await import("@/db");
  return Object.fromEntries(["learn_courses", "learn_nodes", "learn_events", "learn_widgets", "learn_cards", "learn_snapshots"].map((t) => [t, (getSqlite().prepare(`select count(*) as n from ${t}`).get() as { n: number }).n]));
};

test("Learn's move into the Workspace: every bit of progress survives exactly — once, after a backup; interrupted, it moves again whole; the old tables stay", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  const { todoId } = await seedOld();
  const before = await counts();
  const { getSqlite } = await import("@/db");
  const move = await import("@/plugins/learn/to-workspace");

  // Interrupted half-way (a crash, a power cut): nothing of it stays — the next try moves it whole.
  assert.throws(
    () =>
      move.moveCourseToWorkspace(11, {
        interrupt: () => {
          throw new Error("power cut");
        },
      }),
    /power cut/,
  );
  assert.equal((getSqlite().prepare("select count(*) as n from learn_moved").get() as { n: number }).n, 0, "nothing marked moved");

  const r = move.moveLearnOnce();
  assert.ok(r, "moved");
  assert.deepEqual({ moved: r.moved, failed: r.failed }, { moved: 2, failed: 0 });
  assert.equal(path.basename(r.backup), "zeff-before-learn-move.db");
  assert.ok(fs.existsSync(r.backup), "a copy of the database first");
  assert.equal(path.dirname(r.backup), dir, "next to the account's database");
  const Database = (await import("better-sqlite3")).default;
  const copy = new Database(r.backup, { readonly: true });
  assert.equal((copy.prepare("select xp from learn_courses where id = 11").get() as { xp: number }).xp, 885, "the copy has the progress as it was");
  copy.close();
  assert.deepEqual(await counts(), before, "the old tables are left as they were");
  assert.equal(move.moveLearnOnce(), null, "once");

  const store = await import("@/plugins/learn/store");
  const dbs = await import("@/plugins/learn/dbs");
  const ws = await import("@/plugins/workspace/store");
  const c = store.getCourse(11)!;
  assert.ok(c, "the old id still finds the course");
  assert.notEqual(c.id, 11, "it is a row of Courses now");
  assert.equal(ws.rawRows(dbs.learnDbs().courses).filter((x) => x.cells[dbs.P.legacy] === 11).length, 1, "exactly once — the interrupted try left nothing");
  assert.deepEqual(
    { title: c.title, topic: c.topic, goal: c.goal, level: c.level, status: c.status, summary: c.summary, years: c.years, xp: c.xp, streak: c.streak, lastDay: c.lastDay, today: c.today, todayXp: c.todayXp, dailyGoal: c.dailyGoal, reviewTodoId: c.reviewTodoId },
    { title: "Differential geometry", topic: "Differentialgeometrie", goal: "Riemann", level: "Abitur", status: "ready", summary: "From curves to surfaces.", years: 1, xp: 885, streak: 9, lastDay: "2026-11-09", today: "2026-11-09", todayXp: 35, dailyGoal: 60, reviewTodoId: 4242 },
  );
  assert.deepEqual(c.badges, ["first-step", "first-skill", "streak-7"]);
  assert.deepEqual(c.interests, { Physik: 3, Anschauung: 1 });
  assert.deepEqual(c.slots, [{ day: 1, at: "18:00", minutes: 30 }]);
  assert.deepEqual(c.sources.map((s) => s.id), ["s1"]);
  assert.equal(c.createdAt, COURSE.created_at);
  assert.equal(store.getCourse(12)?.status, "researching", "a course still being planned moves too");

  // The plan and the progress on it.
  const { nodes, tree } = store.courseTree(c.id);
  assert.deepEqual(nodes.map((x) => x.key), ["y1", "p1", "a", "a1", "a2", "a3"], "in the plan's order");
  assert.deepEqual(Object.fromEntries(nodes.map((x) => [x.key, tree.status.get(x.key)])), { y1: "active", p1: "active", a: "active", a1: "mastered", a2: "active", a3: "locked" });
  const a1 = store.getNode(c.id, "a1")!;
  const a2 = store.getNode(c.id, "a2")!;
  assert.equal(minute(a1.masteredAt), minute("2026-11-05T18:12:44.123Z"), "mastered when it was (to the minute)");
  assert.equal(minute(a2.activeSince), minute("2026-11-09T18:05:10.000Z"));
  assert.equal(a2.lessonTodoId, todoId, "the lesson's todo (its conversation) stays with its step");
  assert.deepEqual(a2.requires, ["a1"]);
  assert.equal(a2.parent, "a");
  assert.deepEqual(a1.objectives, ["Compute a curve's length"]);
  assert.deepEqual(a1.sources, ["s1"]);
  assert.equal(store.getNode(c.id, "a3")?.minutes, 25);
  assert.deepEqual(nodes.map((x) => x.xp), [500, 150, 50, 10, 10, 10]);
  assert.deepEqual({ steps: tree.progress.steps, mastered: tree.progress.mastered }, { steps: 3, mastered: 1 }, "progress: one of three steps");

  // The widget, its best score, its result and the snapshot of it.
  const [w] = store.nodeWidgets(c.id, "a2");
  assert.equal(w.title, "Curvature of circles");
  assert.equal(w.html, WIDGET_HTML, "its HTML exactly");
  assert.equal(w.bestScore, 0.75);
  assert.deepEqual(w.libs, ["katex"]);
  assert.equal(w.createdAt, "2026-11-09T18:10:00.000Z");
  assert.equal(store.getWidget(5)?.id, w.id, "the old widget id finds it");
  const [res] = store.widgetResults(c.id, "a2");
  assert.equal(res.widget, w.id, "the result names the widget's row");
  assert.equal(res.score, 0.75);
  assert.deepEqual({ correct: res.correct, total: res.total }, { correct: 3, total: 4 });
  assert.deepEqual(res.answers, [{ q: "r = 2", a: "0.5", ok: true }, { q: "line", a: "1", ok: false }]);
  assert.equal(res.snapshotId, 1);
  assert.equal(store.widgetSnapshot(1)?.title, "Curvature of circles");
  assert.deepEqual(store.widgetSnapshot(1)?.libs, ["katex"]);

  // The cards, where they stand.
  const all = store.dueCards(c.id, new Date("2027-01-01T00:00:00Z"));
  const card = all.find((x) => x.front === "Arc length of γ?")!;
  assert.deepEqual({ reps: card.reps, lapses: card.lapses, ease: card.ease, interval: card.interval, back: card.back, nodeKey: card.nodeKey }, { reps: 2, lapses: 1, ease: 2.36, interval: 6, back: "∫|γ′|", nodeKey: "a1" });
  assert.equal(minute(card.due), minute("2026-11-14T08:30:12.000Z"), "due when it was (to the minute)");
  assert.equal(minute(card.last), minute("2026-11-08T08:30:12.000Z"));
  assert.equal(store.dueCards(c.id, new Date("2026-11-10T12:00:00Z")).length, 1, "today: only the card that was due");
  assert.equal(store.dueCount(new Date("2026-11-10T12:00:00Z")).find((x) => x.courseId === c.id)?.due, 1);

  // What was earned, each event as it was.
  const ev = store.recentEvents(c.id);
  assert.deepEqual(ev.map((e) => [e.kind, e.xp, e.nodeKey]), [["review", 1, "a1"], ["widget", 3, "a2"], ["mastered", 10, "a1"]]);
  assert.equal(minute(ev[2].at), minute("2026-11-05T18:12:44.123Z"));
  assert.equal(ev[2].detail.note, "computed it twice");
  assert.equal(ev[0].detail.card, card.id, "the review names the card's row");
  assert.match(store.courseHistory(c.id).join("\n"), /Arc length.*gemeistert: computed it twice/);

  // The lesson's conversation, from its run's log.
  const conv = await import("@/plugins/learn/conversation");
  const msgs = conv.stepMessages(a2.id);
  assert.deepEqual(msgs.map((m) => [m.role, m.kind]), [["you", "message"], ["teacher", "message"], ["teacher", "exercise"], ["you", "message"], ["teacher", "message"]]);
  assert.equal(msgs[0].text, "Los geht's: „Frenet frame“.");
  assert.equal(msgs[2].exercise, w.id, "the exercise shown, linked to its row");
  assert.equal(conv.lessonChanged(todoId), false, "imported: not a change of yours");

  // It goes on from here: the next review and the next step build on the moved state.
  const reviewed = store.reviewCard(9, "good", new Date("2026-11-14T09:00:00Z"));
  assert.equal(reviewed.card.reps, 3, "reviewed by its old id, from where it stood");
  assert.equal(store.getCourse(c.id)!.xp, 886, "a point on top of the moved xp");
  const m = store.masterNode(c.id, "a2", new Date("2026-11-14T09:30:00Z"));
  assert.deepEqual(m.mastered, ["a2"]);
  assert.equal(store.getCourse(c.id)!.xp, 896);
});

test("no old tables (a new account): nothing to move — the flag is set, nothing made twice", async () => {
  const move = await import("@/plugins/learn/to-workspace");
  const { getPref } = await import("@/lib/prefs");
  assert.equal(move.moveLearnOnce(), null);
  assert.equal(getPref(move.MOVED_FLAG, false), true);
});
