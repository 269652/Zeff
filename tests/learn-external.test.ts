import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

/**
 * The benchmark of "Zeff in Zeff" (docs/zeff-in-zeff.md, stage 5): Zeff's Learn rebuilt as an EXTERNAL plugin (zeff-plugins/plugins/learn) —
 * a skill tree over years, phases, skills and steps, spaced repetition, experience, levels, a streak, a live teacher, exercises, study times —
 * as databases, one app view, flows and server functions in a package, using only what an external plugin can use. Node.js runs on this computer
 * here (ZNB_TEST_MODE=docker: in containers).
 */
setupTempData();
const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
process.env.ZEFF_PLUGINS_DIR = PLUGINS;
const MODE = process.env.ZNB_TEST_MODE === "docker" ? "docker" : "host";
const SOURCE = repoPlugin("learn");
const SKIP = skipWithoutRepo("learn");

after(async () => {
  (await import("@/plugins/notebook/sessions")).endAllSessions();
  fs.rmSync(PLUGINS, { recursive: true, force: true });
});

const nodeReady = async () => {
  const rt = await import("@/plugins/notebook/runtimes");
  rt.setNotebookEnabled(true);
  rt.setModeOf("node", MODE);
  return (await rt.languageStatuses()).find((r) => r.id === "node")?.where === MODE;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
test("the plugin folder is a valid external plugin, and the package it ships is on offer once it is on", { skip: SKIP }, async () => {
  fs.cpSync(SOURCE, path.join(PLUGINS, "learn-ext"), { recursive: true });
  const { checkPluginFolder } = await import("@/lib/ext/check");
  const checked = checkPluginFolder(path.join(PLUGINS, "learn-ext"));
  assert.deepEqual(checked.errors, [], checked.errors.join("; "));
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "notebook"]) setInstalled(id, true);
  const { listPackages } = await import("@/plugins/workspace/packages");
  assert.equal(listPackages().some((p) => p.pkg.id === "learn-ext"), false, "off: nothing on offer");
  const { setEnabled } = await import("@/lib/ext/registry");
  setEnabled("learn-ext", true);
  assert.ok(listPackages().some((p) => p.pkg.id === "learn-ext"));
  const { flowActions } = await import("@/plugins/workspace/flows/actions");
  const names = flowActions().filter((a) => a.name.startsWith("learn-ext.")).map((a) => a.name).sort();
  assert.deepEqual(names, ["learn-ext.courses", "learn-ext.dashboard", "learn-ext.grade", "learn-ext.lessontodo", "learn-ext.master", "learn-ext.plan", "learn-ext.progress", "learn-ext.remove", "learn-ext.result", "learn-ext.schedule", "learn-ext.setting", "learn-ext.skillmap"]);
  const { dueSchedules } = await import("@/lib/ext/schedules");
  assert.deepEqual(dueSchedules().map((s) => `${s.plugin}.${s.id}`), ["learn-ext.upkeep"], "the hourly upkeep is due on a first look");
});

test("installing it: the package is remembered, its own tests pass, what it asks for is listed beforehand", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip(`Node.js cannot run in ${MODE} mode here`);
  const life = await import("@/plugins/workspace/package-life");
  const pkg = (await life.findOffered("learn-ext"))!;
  assert.ok(pkg);
  const asks = life.packagePermissions(pkg);
  assert.ok(asks.flows.length >= 8, asks.flows.join("|"));
  assert.deepEqual(asks.plugins, ["notebook"]);
  assert.deepEqual(life.checkRequirements(pkg), []);
  const r = await life.installTracked(pkg, null, { allow: true });
  assert.ok(r.remembered);
  assert.equal(r.tests.length, 12);
  assert.deepEqual(r.tests.filter((x) => !x.ok), [], JSON.stringify(r.tests));
  assert.ok(r.allowed.length >= 8, "the flows were allowed what they ask");
  // The functions are allowed what they need ("Allow what they need" in Settings → Notebook).
  const { declaredFunctions } = await import("@/plugins/notebook/functions");
  const grants = await import("@/plugins/notebook/grants");
  grants.grantNeeds("learn-ext", declaredFunctions().filter((f) => f.plugin === "learn-ext").flatMap((f) => f.needs));
});

test("the server functions: spaced repetition and the game — the same rules as the built-in Learn", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip("no Node.js");
  const { callFunction } = await import("@/plugins/notebook/functions");
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await callFunction("learn-ext", name, args);
    assert.ok(r.ok, JSON.stringify(r));
    return r.value as Record<string, unknown>;
  };
  // Four stacks: 1 every day, 2 every 3 days, 3 every week, 4 every 3 weeks. Good: one up; easy: two up; hard: stays; again: stack 1, today.
  const c1 = await call("review", { box: 1, reps: 0, lapses: 0, ease: 2.5, interval: 0, grade: "good", today: "2026-11-01" });
  assert.deepEqual([c1.box, c1.interval, c1.due], [2, 3, "2026-11-04"]);
  const c2 = await call("review", { ...c1, grade: "hard", today: "2026-11-04" });
  assert.deepEqual([c2.box, c2.interval, c2.due], [2, 3, "2026-11-07"]);
  const c3 = await call("review", { ...c2, grade: "easy", today: "2026-11-07" });
  assert.deepEqual([c3.box, c3.interval, c3.due], [4, 21, "2026-11-28"]);
  assert.equal((await call("review", { ...c3, grade: "easy", today: "2026-11-28" })).box, 4, "no stack above 4");
  const lapse = await call("review", { ...c3, grade: "again", today: "2026-11-28" });
  assert.deepEqual([lapse.box, lapse.lapses, lapse.interval, lapse.due], [1, 1, 0, "2026-11-28"]);
  // A card from before the stacks: put in the one its interval fits (15 days: stack 4).
  assert.equal((await call("review", { reps: 3, interval: 15, grade: "hard", today: "2026-11-01" })).box, 4);
  assert.equal((await callFunction("learn-ext", "review", { grade: "meh" })).ok, false);
  assert.deepEqual(await call("game", { op: "level", xp: 0 }), { level: 1, into: 0, need: 100, share: 0 });
  const lv = await call("game", { op: "level", xp: 110 });
  assert.deepEqual([lv.level, lv.into, lv.need], [2, 10, 130]);
  assert.deepEqual(await call("game", { op: "streak", streak: 6, lastDay: "2026-11-01", today: "2026-11-02" }), { streak: 7, lastDay: "2026-11-02" });
  assert.deepEqual(await call("game", { op: "streak", streak: 6, lastDay: "2026-11-01", today: "2026-11-05" }), { streak: 1, lastDay: "2026-11-05" });
  const badges = (await callFunction("learn-ext", "game", { op: "badges", stats: { stepsMastered: 1, streak: 7, widgets: 10 } })) as { ok: true; value: string[] };
  assert.deepEqual(badges.value, ["first-step", "streak-7", "widgets-10"]);
});

test("the skill tree: statuses from what is mastered, a skill mastered through its steps, mastering cascades and gives its points once", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip("no Node.js");
  const { callFunction } = await import("@/plugins/notebook/functions");
  const store = await import("@/plugins/workspace/store");
  const dbs = (await import("@/plugins/workspace/package-life")).getInstalled("learn-ext")!.map;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await callFunction("learn-ext", name, args);
    assert.ok(r.ok, JSON.stringify(r));
    return r.value as Record<string, any>;
  };
  const status = (s: Record<string, any>, key: string) => s.nodes.find((n: { key: string }) => n.key === key).status;
  const s0 = await call("state", {});
  assert.equal(status(s0, "p1.s1.a"), "available");
  assert.equal(status(s0, "p1.s2.a"), "locked", "its skill requires the first skill");
  assert.deepEqual(s0.next, ["p1.s1.a"]);

  const m = await call("master", { step: "Basis and dimension", today: "2026-11-01" });
  assert.equal(m.gained, 60, "10 for the step and 50 for the skill it completed");
  assert.deepEqual(m.completed.sort(), ["Basis and dimension", "Vector spaces"]);
  assert.deepEqual(m.opened, ["p1.s2.a"]);
  const p = store.getPage(dbs.i2)!.schema!.properties;
  const course = store.rawRows(dbs.i2)[0];
  assert.deepEqual([course.cells[p.find((x) => x.name === "XP")!.id], course.cells[p.find((x) => x.name === "Level")!.id], course.cells[p.find((x) => x.name === "Streak")!.id]], [60, 1, 1]);
  const s1 = await call("state", {});
  assert.equal(status(s1, "p1.s1"), "mastered");
  assert.equal(status(s1, "p1.s2.a"), "available");
  assert.equal((await call("master", { step: "Basis and dimension" })).gained, 0, "not twice");
  const locked = await callFunction("learn-ext", "master", { step: "Curvature" });
  assert.equal(locked.ok, false);
  assert.match(locked.ok ? "" : locked.error, /locked/);
  const skill = await callFunction("learn-ext", "master", { step: "Plane curves" });
  assert.equal(skill.ok, false);
  assert.match(skill.ok ? "" : skill.error, /through its steps/);
  const map = await call("skillmap", {});
  assert.deepEqual(map.nodes.map((n: { key: string; status: string }) => [n.key, n.status]), [["p1.s1", "mastered"], ["p1.s2", "available"]]);
  assert.deepEqual([map.nodes[1].after, map.nodes[1].foundation], [[], true], "the first phase's skills are the foundations: one after another, not joined by lines");
  assert.equal(map.groups.length, 1, "the phase is a band");
  assert.deepEqual(map.route.keys, ["p1.s1", "p1.s2"], "the red thread: walked, then the plan ahead");
  const list = await call("courses", {});
  assert.deepEqual(list.courses.map((c: { title: string; status: string; steps: number }) => [c.title, c.status, c.steps]), [["Differential geometry", "ready", 3]]);
});

test("cards and exercises: a card is scheduled and earns experience; an exercise keeps its tries and gives XP only for doing better", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip("no Node.js");
  const { callFunction } = await import("@/plugins/notebook/functions");
  const store = await import("@/plugins/workspace/store");
  const dbs = (await import("@/plugins/workspace/package-life")).getInstalled("learn-ext")!.map;
  const grade = await callFunction("learn-ext", "grade", { card: "What is a basis?", grade: "good", today: "2026-11-01" });
  assert.ok(grade.ok, JSON.stringify(grade));
  assert.deepEqual([(grade.value as { due: string }).due, (grade.value as { gained: number }).gained, (grade.value as { box: number }).box], ["2026-11-04", 5, 2]);
  const cardProps = store.getPage(dbs.i4)!.schema!.properties;
  const card = store.rawRows(dbs.i4).find((r) => r.title === "What is a basis?")!;
  assert.deepEqual([card.cells[cardProps.find((p) => p.name === "Reps")!.id], card.cells[cardProps.find((p) => p.name === "Due")!.id], card.cells[cardProps.find((p) => p.name === "Box")!.id]], [1, "2026-11-04", 2]);

  const bad = await callFunction("learn-ext", "exercise", { step: "Basis and dimension", title: "Bad", spec: { title: "x", items: [{ type: "number", q: "g?", answer: "viel" }] } });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /wasn't made/);
  const made = await callFunction("learn-ext", "exercise", { step: "Basis and dimension", title: "Basis quiz", spec: { title: "Basis quiz", items: [{ type: "number", q: "How many vectors form a basis of the plane?", answer: 2 }] } });
  assert.ok(made.ok, JSON.stringify(made));
  const exId = (made.value as { id: number }).id;
  const r1 = await callFunction("learn-ext", "result", { exercise: exId, score: 0.4, answers: JSON.stringify([{ q: "q", a: "1", ok: false }]), snapshot: "<p>try</p>" });
  assert.equal((r1.ok && (r1.value as { gain: number }).gain) || 0, 2, "round(5 * 0.4)");
  const r2 = await callFunction("learn-ext", "result", { exercise: exId, score: 0.4 });
  assert.equal((r2.ok && (r2.value as { gain: number }).gain) || 0, 0, "no better: nothing");
  const r3 = await callFunction("learn-ext", "result", { exercise: exId, score: 1 });
  assert.equal((r3.ok && (r3.value as { gain: number }).gain) || 0, 3, "up to 5 in all");
  assert.equal(store.rawRows(dbs.i20).length, 3, "every try is kept");

  // A card keeps an exercise of its own (checked first: a wrong one makes no card at all), shown in the review with no AI then.
  const quiz = { title: "Basis", items: [{ type: "number", q: "How many vectors form a basis of R³?", answer: 3 }] };
  const wrong = await callFunction("learn-ext", "cards", { step: "Basis and dimension", cards: [{ front: "Basis of R³?", back: "3 vectors", exercise: { title: "x", items: [{ type: "number", q: "?", answer: "viel" }] } }] });
  assert.equal(wrong.ok, false);
  assert.match(wrong.ok ? "" : wrong.error, /No cards were made/);
  const before = store.rawRows(dbs.i4).length;
  const withEx = await callFunction("learn-ext", "cards", { step: "Basis and dimension", cards: [{ front: "Basis of R³?", back: "3 vectors", exercise: quiz }, { front: "Dimension?", back: "the number of basis vectors" }] });
  assert.ok(withEx.ok, JSON.stringify(withEx));
  assert.deepEqual([store.rawRows(dbs.i4).length - before, (withEx.value as { withExercise: number }).withExercise], [2, 1]);
  const exOf = (title: string) => store.rawRows(dbs.i4).find((r) => r.title === title)!.cells[cardProps.find((p) => p.name === "Exercise")!.id];
  assert.deepEqual(JSON.parse(String(exOf("Basis of R³?"))), quiz);
  // A card without one gets one later (the card helper keeps the exercise it made).
  const plain = store.rawRows(dbs.i4).find((r) => r.title === "Dimension?")!;
  const kept = await callFunction("learn-ext", "cardexercise", { card: `card-${plain.id}`, exercise: quiz });
  assert.ok(kept.ok, JSON.stringify(kept));
  assert.deepEqual(JSON.parse(String(exOf("Dimension?"))), quiz);
  // The Learn page's overview: totals over every course, cards by stack, one line per course.
  const dash = await callFunction("learn-ext", "dashboard", {});
  assert.ok(dash.ok, JSON.stringify(dash));
  const d = dash.value as { totals: { cards: number; courses: number; exercisesDone: number }; stacks: { box: number; n: number }[]; courses: { title: string }[] };
  assert.equal(d.totals.cards, store.rawRows(dbs.i4).length);
  assert.equal(d.stacks.reduce((a, x) => a + x.n, 0), d.totals.cards, "every card is in one stack");
  assert.ok(d.totals.courses >= 1 && d.courses.length === d.totals.courses);
  assert.equal(d.totals.exercisesDone, 1, "the basis quiz was done");
});

test("the settings of a course, the study times in the calendar, the upkeep, and a course removed with everything of it", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip("no Node.js");
  const { callFunction } = await import("@/plugins/notebook/functions");
  const store = await import("@/plugins/workspace/store");
  const dbs = (await import("@/plugins/workspace/package-life")).getInstalled("learn-ext")!.map;
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["calendar", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const ok = async (name: string, args: Record<string, unknown>) => {
    const r = await callFunction("learn-ext", name, args);
    assert.ok(r.ok, JSON.stringify(r));
    return r.value as Record<string, any>;
  };
  await ok("coursesetting", { course: "Differential geometry", interest: "Kurven", level: 3, dailyGoal: 100 });
  const prog = await ok("progress", {});
  assert.equal(prog.course.dailyGoal, 100);
  assert.equal(prog.pathList.find((p: { name: string }) => p.name === "Kurven")?.interest, 3);
  const wrong = await callFunction("learn-ext", "coursesetting", { course: "Differential geometry", slotDay: 9, slotTime: "18:00" });
  assert.equal(wrong.ok, false);
  const withSlot = await ok("coursesetting", { course: "Differential geometry", slotDay: 0, slotTime: "18:30", slotMinutes: 45 });
  assert.deepEqual(withSlot.changed, ["Slots"]);
  const events = await ok("studytimes", {});
  assert.equal(events.added, 0, "the same four weeks again: nothing new (they were made when the slot was added)");
  assert.ok(events.kept >= 4, `about four weeks of Mondays kept (${events.kept})`);
  const up = await ok("upkeep", {});
  assert.ok(up.todos >= 1, "cards are due: a review todo");

  const removed = await ok("removecourse", { course: "Differential geometry" });
  assert.ok(removed.removed.steps >= 6);
  assert.equal(store.rawRows(dbs.i2).length, 0);
  assert.equal(store.rawRows(dbs.i3).length, 0);
  assert.equal(store.rawRows(dbs.i4).length, 0);
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(eventsBetween(today, new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)).filter((e) => (e.description ?? "").startsWith("learn-ext:")).length, 0, "its study times left the calendar");
});

test("a newer version of the plugin updates the app in place: yours stays, the data is migrated, the history says so", { skip: SKIP }, async (t) => {
  if (!(await nodeReady())) return t.skip("no Node.js");
  const life = await import("@/plugins/workspace/package-life");
  const store = await import("@/plugins/workspace/store");
  const inst = life.getInstalled("learn-ext")!;
  const stepsId = inst.map.i3;
  const sch = store.getPage(stepsId)!.schema!;
  store.updateSchema(stepsId, { ...sch, properties: [...sch.properties, { id: "mine", name: "My note", type: "text" }] });
  const file = path.join(PLUGINS, "learn-ext", "learn.package.json");
  const next = JSON.parse(fs.readFileSync(file, "utf8"));
  next.version = "1.4.0";
  next.items = next.items.map((i: { id: string; schema?: { properties: Record<string, unknown>[] } }) => {
    if (i.id === "i3" && i.schema) i.schema.properties.push({ id: "notes", name: "Notes", type: "text" });
    if (i.id === "i4" && i.schema) i.schema.properties = i.schema.properties.map((p) => (p.id === "last" ? { ...p, name: "LastReviewed" } : p));
    return i;
  });
  next.migrations = [{ from: "1.3.0", to: "1.4.0", steps: [{ op: "rename_property", db: "i4", from: "Last", to: "LastReviewed" }] }];
  fs.writeFileSync(file, JSON.stringify(next));
  const status = await life.packageStatus();
  assert.deepEqual([status[0].version, status[0].offered, status[0].updateAvailable], ["1.3.0", "1.4.0", true]);
  await life.updateTracked("learn-ext", (await life.offeredPackage("learn-ext"))!);
  const steps = store.getPage(stepsId)!.schema!.properties.map((p) => p.name);
  assert.ok(steps.includes("Notes") && steps.includes("My note"), steps.join(","));
  const cards = store.getPage(inst.map.i4)!.schema!.properties.map((p) => p.name);
  assert.ok(cards.includes("LastReviewed") && !cards.includes("Last"));
  assert.deepEqual(life.getInstalled("learn-ext")!.history.map((e) => [e.action, e.to]), [["install", "1.3.0"], ["update", "1.4.0"]]);
});
