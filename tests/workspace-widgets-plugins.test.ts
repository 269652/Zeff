import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The widgets the plugins bring — only what shows live data with an action right there: unread mail and chats (read again), dates
 * coming up (done), workers running (stop), the best news (save, like, hide), your routines (run). Each is checked on real data.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos", "people", "news", "outlook-mail", "teams", "mail-client"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return await import("@/plugins/workspace/widgets");
}
const list = (d: { kind: string; items?: { id: string; text: string; badge?: string; detail?: string; href?: string; icon?: string; meta?: string; actions?: { id: string }[] }[] }) => (d.kind === "list" ? d.items! : []);

test("every plugin's widgets are registered with a plugin that is installed — and carry the one thing that makes them worth it", async () => {
  const x = await world();
  const ids = x.widgetCatalog().map((w) => w.id);
  for (const id of ["mail.unread", "people.upcoming", "work.runs", "news.top", "workspace.routines"]) assert.ok(ids.includes(id), `${id} is there`);
  for (const w of x.widgetCatalog().filter((w) => ["mail.unread", "people.upcoming", "work.runs", "news.top", "workspace.routines"].includes(w.id))) assert.ok(w.actions, `${w.id} has an action`);
});

test("unread: the newest unread messages (who, what, when) with the count — or the inboxes with theirs; read again from the widget", async () => {
  const x = await world();
  const { saveMails } = await import("@/lib/mail/store");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  saveMails([
    { convId: "U1", folder: "Posteingang", from: "Anna", fromEmail: "anna@x.example", subject: "Eins", preview: "…", receivedAt: ago(1), unread: true },
    { convId: "U2", folder: "Posteingang", from: "Ben", fromEmail: "ben@x.example", subject: "Zwei", preview: "…", receivedAt: ago(2), unread: true },
    { convId: "U3", folder: "Posteingang", from: "Cora", fromEmail: "cora@x.example", subject: "Drei", preview: "…", receivedAt: ago(3), unread: false },
  ]);
  const db = createSourceDatabase("mail");
  await runPipeline(db, { ai: false });
  const d = await x.widgetData("mail.unread", {});
  assert.equal(d.kind === "list" && d.count, 2, "two unread");
  const items = list(d);
  assert.deepEqual(items.map((i) => i.text), ["Eins", "Zwei"], "the newest first, the read one not");
  assert.equal(items[0].icon, "AN", "the sender as initials");
  assert.equal(items[0].href, `/workspace/${db}`, "into the inbox");
  const boxes = list(await x.widgetData("mail.unread", { show: "inboxes" }));
  const mine = boxes.find((i) => i.href === `/workspace/${db}`)!;
  assert.ok(mine, "the mail database");
  assert.equal(mine.meta, "2", "two unread");
  assert.ok(mine.actions?.some((a) => a.id === "refresh"));
  const after = await x.widgetAct("mail.unread", "refresh", { id: String(db) }, { show: "inboxes" });
  assert.equal(after.kind, "list");
});

test("upcoming dates: the next dates of your people — done for this time takes one off", async () => {
  const x = await world();
  const p = await import("@/plugins/people/store");
  const soon = new Date(Date.now() + 2 * 864e5);
  const anna = p.createPerson({ name: "Anna Widget" });
  p.addDate(anna, { kind: "birthday", day: soon.getDate(), month: soon.getMonth() + 1, year: 1990 });
  const far = new Date(Date.now() + 200 * 864e5);
  p.addDate(p.createPerson({ name: "Fern Widget" }), { kind: "birthday", day: far.getDate(), month: far.getMonth() + 1, year: 1990 });
  const d = await x.widgetData("people.upcoming", { days: 14 });
  const items = list(d);
  assert.ok(items.some((i) => /Anna Widget/.test(i.text)), "within the days");
  assert.ok(!items.some((i) => /Fern Widget/.test(i.text)), "far off: not shown");
  const mine = items.find((i) => /Anna Widget/.test(i.text))!;
  assert.ok(mine.actions?.some((a) => a.id === "reminded"));
  const after = await x.widgetAct("people.upcoming", "reminded", { id: mine.id }, { days: 14 });
  assert.ok(!list(after).some((i) => /Anna Widget/.test(i.text)), "done: gone until the next time");
});

test("workers: queued and running runs of Code with their todo — stop takes one out", async () => {
  const x = await world();
  const { addManualTodo } = await import("@/lib/todos/store");
  const { createRun, getRun } = await import("@/lib/work/store");
  const todo = addManualTodo({ ticket: "", text: "Bericht schreiben (Widget)" });
  const run = createRun({ ticket: "", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  const d = await x.widgetData("work.runs", { hours: 3 });
  const mine = list(d).find((i) => /Bericht schreiben/.test(i.text))!;
  assert.ok(mine, "the run");
  assert.equal(mine.href, `/work?run=${run.id}`);
  assert.ok(mine.actions?.some((a) => a.id === "stop"));
  const after = await x.widgetAct("work.runs", "stop", { id: String(run.id) }, { hours: 3 });
  assert.equal(getRun(run.id)!.status, "cancelled");
  assert.ok(!list(after).some((i) => i.id === String(run.id) && i.actions?.some((a) => a.id === "stop")), "a stopped run offers no stop");
});

test("news: the best of what is new — saved, liked or hidden right there", async () => {
  const x = await world();
  const n = await import("@/plugins/news/store");
  const src = n.addSource({ name: "Heise", url: "https://heise.example/rss2" });
  n.addItems({ id: src.id, name: "Heise" }, [
    { guid: "w1", url: "https://heise.example/w1", title: "Eine wichtige Meldung für das Widget", summary: "Text", publishedAt: new Date().toISOString() },
    { guid: "w2", url: "https://heise.example/w2", title: "Noch eine Meldung für das Widget", summary: "Text", publishedAt: new Date().toISOString() },
  ]);
  const d = await x.widgetData("news.top", { limit: 5 });
  const items = list(d);
  assert.ok(items.length >= 2);
  const first = items.find((i) => /wichtige Meldung/.test(i.text))!;
  assert.deepEqual(first.actions?.map((a) => a.id).sort(), ["hide", "like", "save"]);
  assert.equal(first.href, "https://heise.example/w1");
  await x.widgetAct("news.top", "save", { id: first.id }, { limit: 5 });
  assert.equal(n.getItem(Number(first.id))!.state, "saved");
  await x.widgetAct("news.top", "like", { id: first.id }, { limit: 5 });
  assert.equal(n.getItem(Number(first.id))!.vote, 1);
  const second = items.find((i) => /Noch eine/.test(i.text))!;
  const after = await x.widgetAct("news.top", "hide", { id: second.id }, { limit: 5 });
  assert.ok(!list(after).some((i) => i.id === second.id), "hidden: no longer on the list");
});

test("routines: yours with how they last ended — run one from the widget", async () => {
  const x = await world();
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const db = w.createPage({ kind: "database", title: "Ziel" });
  const page = w.createPage({ title: "Meine Routine (Widget)" });
  r.createRoutine(page, "automation", { enabled: true, steps: [{ id: "c", kind: "create", db, title: "vom Widget" }] });
  const d = await x.widgetData("workspace.routines", {});
  const mine = list(d).find((i) => /Meine Routine/.test(i.text))!;
  assert.ok(mine);
  assert.ok(mine.actions?.some((a) => a.id === "run"));
  const after = await x.widgetAct("workspace.routines", "run", { id: String(page) }, {});
  assert.deepEqual(w.rawRows(db).map((row) => row.title), ["vom Widget"], "it ran");
  assert.match(list(after).find((i) => /Meine Routine/.test(i.text))!.detail ?? "", /done/i, "and the list shows how it ended");
});
