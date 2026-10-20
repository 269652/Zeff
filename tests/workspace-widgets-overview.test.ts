import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Widgets that use what Zeff knows: an overview in figures (hours, todos, merge requests, workers, agent jobs), a list of what needs
 * attention, and any database drawn as cards by its view's card template — filter, sort and limit of the view kept.
 */
let seeded = false;
async function seed() {
  if (seeded) return;
  seeded = true;
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "gitlab", "jira", "todos", "work", "zeiterfassung"]) setInstalled(id, true);
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const store = await import("@/lib/boards/store");
  const { createRun } = await import("@/lib/work/store");
  createJob({ number: "100500", name: "Dash" });
  const today = new Date().toLocaleDateString("sv-SE");
  createEntry({ jobNumber: "100500", date: today, hours: 2.5, description: "Heute", ticket: "DSH-1" } as never, "web");
  createEntry({ jobNumber: "100500", date: today, hours: 1, description: "Auch heute", ticket: "DSH-2" } as never, "web");
  const old = new Date(Date.now() - 6 * 864e5).toISOString();
  const mr = (iid: number, state: string, updatedAt: string, title: string) => ({ key: `mr:g/p!${iid}`, kind: "mr" as const, project: "g/p", projectUrl: "https://git.example.com/g/p", ref: `!${iid}`, title, body: "", author: "m", state, createdAt: updatedAt, updatedAt, url: `https://git.example.com/g/p/-/merge_requests/${iid}`, branch: `feature/DSH-${iid}-x`, parent: null, thread: null, resolvedAt: null });
  saveGitlabItems([mr(1, "opened", old, "feat(DSH-1): alt"), mr(2, "opened", new Date().toISOString(), "feat(DSH-2): neu"), mr(3, "merged", old, "feat(DSH-3): fertig")] as never);
  const t1 = store.addManualTodo({ ticket: "DSH-1", text: "Überfälliges erledigen" });
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.todos).set({ due: "2026-01-01" }).where(eq(schema.todos.id, t1.id)).run();
  store.addManualTodo({ ticket: "DSH-2", text: "Normal" });
  const run = createRun({ ticket: "DSH-1", todoId: t1.id, mode: "instruct", provider: "claude", model: "sonnet", permissionMode: "auto", repo: null, prompt: "p" });
  (await import("@/lib/work/store")).updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
}

test("overview: figures of the day as tiles — hours, todos (overdue noted), merge requests (waiting noted), workers", async () => {
  await seed();
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const d = await widgetData("workspace.overview", {});
  assert.equal(d.kind, "stats");
  if (d.kind !== "stats") return;
  const tile = (label: RegExp) => d.tiles.find((t) => label.test(t.label))!;
  assert.equal(tile(/hours today/i).value, "3.5 h");
  assert.equal(tile(/open todos/i).value, "2");
  assert.match(tile(/open todos/i).detail ?? "", /1 overdue/);
  assert.equal(tile(/open merge requests/i).value, "2");
  assert.match(tile(/open merge requests/i).detail ?? "", /1 .*(waiting|without)/i);
  assert.equal(tile(/workers/i).value, "1");
});

test("attention: what needs you, most pressing first — an overdue todo, a merge request without movement", async () => {
  await seed();
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const d = await widgetData("workspace.attention", { limit: 10 });
  assert.equal(d.kind, "list");
  if (d.kind !== "list") return;
  const text = d.items.map((i) => `${i.badge}|${i.text}`).join("\n");
  assert.match(text, /overdue\|Überfälliges erledigen/i);
  assert.match(text, /feat\(DSH-1\): alt/);
  assert.doesNotMatch(text, /feat\(DSH-2\): neu/, "a fresh merge request is no concern");
  assert.doesNotMatch(text, /fertig/, "a merged one neither");
  assert.match(d.items[0].badge ?? "", /overdue/i, "the overdue todo comes first");
});

test("database widget: a database drawn as cards by its view's template, the view's filter, sort and limit kept", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const status = { id: "st", name: "Status", type: "status" as const, options: [{ id: "o1", name: "In Arbeit", color: "blue", group: "doing" as const }, { id: "o2", name: "Fertig", color: "green", group: "done" as const }] };
  const hours = { id: "h", name: "Hours", type: "number" as const };
  const id = w.createPage({
    kind: "database",
    title: "Cockpit",
    schema: {
      titleName: "Ticket",
      properties: [status, hours],
      views: [{ id: "v1", name: "Open", type: "gallery", filter: { op: "and", rules: [{ prop: "st", cond: "is", value: "o1" }] }, sorts: [{ prop: "h", dir: "desc" }], hidden: [], card: "<b>{{ title }}</b> {{ Hours | hours }}" }],
    },
  });
  w.addRow(id, { title: "A", cells: { st: "o1", h: 1 } });
  w.addRow(id, { title: "B", cells: { st: "o1", h: 5 } });
  w.addRow(id, { title: "C", cells: { st: "o2", h: 9 } });
  w.addRow(id, { title: "D", cells: { st: "o1", h: 3 } });
  const d = await widgetData("workspace.database", { database: "Cockpit", view: "Open", limit: 2 });
  assert.equal(d.kind, "cards");
  if (d.kind !== "cards") return;
  assert.equal(d.cards.length, 2, "the limit");
  const { vnodeToString } = await import("@/plugins/workspace/card-template");
  assert.deepEqual(d.cards.map((c) => vnodeToString(c.nodes)), ["<b>B</b> 5 h", "<b>D</b> 3 h"], "filtered (no C), sorted by Hours descending, drawn by the template");
  assert.match(d.cards[0].href ?? "", new RegExp(`/workspace/${id}\\?row=`));
  const missing = await widgetData("workspace.database", { database: "Gibt es nicht" });
  assert.equal(missing.kind, "error");
  // The database by its page id works too; without a template the automatic starter draws the card.
  const plain = await widgetData("workspace.database", { database: String(id), limit: 1 });
  assert.equal(plain.kind, "cards");
});

test("the Ticket cockpit template: tickets joined with hours, merge requests, todos and runs; the Dashboard starts with the overview", async () => {
  await seed();
  const w = await import("@/plugins/workspace/store");
  const { fromTemplate, templateMetas } = await import("@/plugins/workspace/templates");
  assert.ok(templateMetas().some((m) => m.key === "ticket-cockpit" && m.kind === "database"));
  const id = fromTemplate("ticket-cockpit", null);
  for (const t of ["DSH-1", "DSH-2"]) w.addRow(id, { title: t, cells: {} });
  const d = w.rowsOf(id)!;
  const prop = (n: string) => d.schema.properties.find((p) => p.name === n)!.id;
  const cell = (t: string, n: string) => d.rows.find((r) => r.title === t)!.cells[prop(n)];
  assert.equal(cell("DSH-1", "Hours"), 2.5);
  assert.equal(cell("DSH-1", "Open MRs"), 1);
  assert.equal(cell("DSH-1", "Open todos"), 1);
  assert.equal(cell("DSH-1", "Workers"), 1);
  assert.ok(d.schema.views[0].type === "gallery" && d.schema.views[0].card, "a gallery with its card template");
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const cards = await widgetData("workspace.database", { database: "Ticket cockpit", limit: 5 });
  assert.equal(cards.kind, "cards");
  if (cards.kind === "cards") assert.equal(cards.cards.length, 2);
  const dash = JSON.stringify(w.getPage(fromTemplate("dashboard", null))!.content);
  assert.ok(dash.indexOf('"workspace.overview"') > -1 && dash.indexOf('"workspace.overview"') < dash.indexOf('"flexBox"'), "the overview comes first");
});
