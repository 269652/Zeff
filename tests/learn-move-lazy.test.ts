import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

const dir = setupTempData();

/** Learn turned on again after the server started (its start didn't move anything): its first use moves the old tables — after the backup. */
test("Learn's old tables are moved the first time Learn is used, after a backup — the course with its progress is there at once", async () => {
  const { getSqlite } = await import("@/db");
  const d = getSqlite();
  d.exec(`
    create table learn_courses (id integer primary key autoincrement, topic text not null, goal text not null default '', level text not null default '', status text not null default 'researching', title text not null default '', summary text not null default '', years real not null default 0, sources text not null default '[]', problems text not null default '[]', error text, interests text not null default '{}', daily_goal integer not null default 50, xp integer not null default 0, streak integer not null default 0, last_day text, today text, today_xp integer not null default 0, badges text not null default '[]', created_at text not null, updated_at text not null);
    create table learn_nodes (id integer primary key autoincrement, course_id integer not null, key text not null, kind text not null, parent_key text, title text not null, summary text not null default '', objectives text not null default '[]', requires text not null default '[]', path text, xp integer not null default 0, minutes integer, sources text not null default '[]', ord integer not null default 0, mastered_at text, active_since text, lesson_todo_id integer, unique (course_id, key));
  `);
  // (A course from before study times existed: its table has no slots, no review todo.)
  d.prepare("insert into learn_courses (id, topic, status, title, xp, streak, last_day, badges, created_at, updated_at) values (1, 'Französisch', 'ready', 'Französisch B2', 120, 4, '2026-11-09', '[\"first-step\"]', '2026-11-01T10:00:00.000Z', '2026-11-09T10:00:00.000Z')").run();
  d.prepare("insert into learn_nodes (course_id, key, kind, title, xp, ord, mastered_at) values (1, 's1', 'step', 'Le passé composé', 10, 0, '2026-11-09T10:00:00.000Z')").run();
  d.prepare("insert into learn_nodes (course_id, key, kind, title, xp, ord, requires) values (1, 's2', 'step', 'L''imparfait', 10, 1, '[\"s1\"]')").run();
  const store = await import("@/plugins/learn/store");
  const [c] = store.listCourses();
  assert.ok(c, "there at its first use");
  assert.deepEqual({ title: c.title, xp: c.xp, streak: c.streak, lastDay: c.lastDay, badges: c.badges, slots: c.slots, reviewTodoId: c.reviewTodoId }, { title: "Französisch B2", xp: 120, streak: 4, lastDay: "2026-11-09", badges: ["first-step"], slots: [], reviewTodoId: null });
  assert.equal(store.courseTree(c.id).tree.status.get("s1"), "mastered");
  assert.equal(store.courseTree(c.id).tree.status.get("s2"), "available");
  assert.ok(fs.existsSync(path.join(dir, "zeff-before-learn-move.db")), "the backup first");
  assert.equal(store.listCourses().length, 1, "once");
});
