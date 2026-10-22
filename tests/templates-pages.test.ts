import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances", "calendar"]) setInstalled(p, true);
  await import("@/plugins/contributions");
}
const widgetsOf = async (id: number) => {
  const { getPage } = await import("@/plugins/workspace/store");
  return [...JSON.stringify(getPage(id)!.content).matchAll(/"widget":"([a-z.]+)"/g)].map((m) => m[1]);
};

test("the Finances page with the Finances plugin: your debts in figures, the payments ahead both ways, the deadlines from your letters", async () => {
  await setup();
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  assert.deepEqual(await widgetsOf(await fromTemplate("finances", null)), ["finances.figures", "finances.payments", "finances.payments", "cases.due"]);
});

test("the Finances widgets: the figures and the payments coming up, from the debts database — the overdue first, each leading to its row", async () => {
  await setup();
  const { ensureDebtsDatabase } = await import("@/plugins/finances/database");
  const db = (await ensureDebtsDatabase())!;
  const { createDebt } = await import("@/plugins/finances/own");
  createDebt({ title: "Reparatur", creditorName: "Chris", creditorKind: "person", amount: 300, due: day(-2), installment: 100 });
  createDebt({ dir: "owed", title: "Konzert", creditorName: "Lea", creditorKind: "person", amount: 60, due: day(10), installment: null });
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const figures = await widgetData("finances.figures", { dir: "owe" });
  assert.equal(figures.kind, "stats");
  assert.match(JSON.stringify(figures), /300/);
  const pay = await widgetData("finances.payments", { dir: "owe", days: 45, limit: 8 });
  assert.equal(pay.kind, "list");
  if (pay.kind !== "list") return;
  assert.equal(pay.items[0].tone, "bad", "the overdue first");
  assert.match(pay.items[0].text, /Chris/);
  assert.match(pay.items[0].href!, new RegExp(`/workspace/${db}\\?row=`));
  const owed = await widgetData("finances.payments", { dir: "owed", days: 45, limit: 8 });
  assert.ok(owed.kind === "list" && owed.items.length === 1 && /Lea/.test(owed.items[0].text));
});

test("the weekly review shows what you got done this week, the agenda and the dates coming; the meeting starts with the brief of who you meet", async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const db = getSqlite();
  db.prepare("insert into todos (ticket, text, status, owner, done_at) values ('', 'Angebot verschickt', 'done', 'me', ?)").run(new Date().toISOString());
  db.prepare("insert into todos (ticket, text, status, owner, done_at) values ('', 'Vor Monaten', 'done', 'me', ?)").run(new Date(Date.now() - 60 * 864e5).toISOString());
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  const review = await widgetsOf(await fromTemplate("weekly-review", null));
  assert.ok(review.includes("todos.done") && review.includes("calendar.agenda") && review.includes("people.upcoming"), review.join());
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const done = await widgetData("todos.done", { since: "week", limit: 10 });
  assert.ok(done.kind === "list" && done.items.some((i) => i.text === "Angebot verschickt") && !done.items.some((i) => i.text === "Vor Monaten"));
  assert.equal((await widgetsOf(await fromTemplate("meeting", null)))[0], "people.briefs");
  // The review writes itself: an agent under it, on Fridays at three.
  const reviewPage = await fromTemplate("weekly-review", null);
  const { tree } = await import("@/plugins/workspace/store");
  const agent = tree().find((x) => x.parentId === reviewPage)!;
  const { getRoutine } = await import("@/plugins/workspace/routines");
  const r = getRoutine(agent.id)!;
  assert.equal(r.kind, "agent");
  assert.ok(r.enabled);
  assert.ok(r.triggers.some((x) => x.kind === "schedule" && x.at === "15:00" && x.days?.includes(5)), "Fridays at three");
});
