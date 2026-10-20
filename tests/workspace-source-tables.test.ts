import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Everything Zeff knows is something a database can join: besides the booked time, the merge requests, the Jira comments, the todos and the
 * worker runs are sources a relation can match (by ticket) — then rollups give "open MRs", "days since the last comment", "open todos",
 * "worker runs" per ticket, live, without a database made of each.
 */
test("the sources a relation can point at: time, merge requests, Jira comments, todos, worker runs — each with its properties", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "gitlab", "jira", "todos", "work"]) setInstalled(id, true);
  const { relationSources, sourceTable } = await import("@/plugins/workspace/source-table");
  const ids = relationSources().map((s) => s.id).sort();
  for (const want of ["time", "mrs", "jira-comments", "todos", "runs"]) assert.ok(ids.includes(want), `${want} is offered (${ids.join(", ")})`);
  const names = (id: string) => sourceTable(id)!.schema.properties.map((p) => p.name);
  assert.ok(["Ticket", "State", "Branch", "Project"].every((n) => names("mrs").includes(n)), names("mrs").join());
  assert.ok(["Ticket", "Author", "Date"].every((n) => names("jira-comments").includes(n)));
  assert.ok(["Ticket", "Status", "Owner"].every((n) => names("todos").includes(n)));
  assert.ok(["Ticket", "Status", "Mode"].every((n) => names("runs").includes(n)));
});

test("a ticket database joins them by its key: open MRs, days since the last comment, open todos, worker runs", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "gitlab", "jira", "todos", "work"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const { addManualTodo } = await import("@/lib/boards/store");
  const { createRun } = await import("@/lib/work/store");
  const w = await import("@/plugins/workspace/store");
  const { sourceTable } = await import("@/plugins/workspace/source-table");

  const mr = (iid: number, branch: string, state: string, title: string) => ({ key: `grp/p!${iid}`, kind: "mr" as const, project: "grp/p", projectUrl: "https://git.example.com/grp/p", ref: `!${iid}`, title, body: "", author: "moritz", state, createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-18T10:00:00Z", url: `https://git.example.com/grp/p/-/merge_requests/${iid}`, branch, parent: null, thread: null, resolvedAt: null });
  saveGitlabItems([mr(1, "feature/PROJ-1-footer", "opened", "feat(PROJ-1): footer"), mr(2, "feature/PROJ-1-other", "merged", "feat(PROJ-1): other"), mr(3, "feature/PROJ-2-nav", "opened", "feat(PROJ-2): nav")]);
  const db = getDb();
  db.insert(schema.jiraComments).values([{ id: "c1", ticket: "PROJ-1", author: "Chris", at: "2026-10-15T09:00:00Z", body: "bitte prüfen" }, { id: "c2", ticket: "PROJ-1", author: "Moritz", at: "2026-10-17T09:00:00Z", body: "ok" }] as never).run();
  addManualTodo({ ticket: "PROJ-1", text: "Footer testen" });
  addManualTodo({ ticket: "PROJ-1", text: "Mail an Kunde schreiben" });
  addManualTodo({ ticket: "PROJ-2", text: "Navigation prüfen" });
  createRun({ ticket: "PROJ-1", todoId: 1, mode: "instruct", provider: "claude", model: "sonnet", permissionMode: "auto", repo: null, prompt: "p" });

  const prop = (src: string, name: string) => sourceTable(src)!.schema.properties.find((p) => p.name === name)!;
  const rel = (id: string, src: string) => ({ id, name: src, type: "relation" as const, relationSource: src, match: { from: "title", to: prop(src, "Ticket").id } });
  const tickets = w.createPage({
    kind: "database",
    title: "Tickets",
    schema: {
      titleName: "Ticket",
      properties: [
        rel("rm", "mrs"), rel("rc", "jira-comments"), rel("rt", "todos"), rel("rr", "runs"),
        { id: "openmrs", name: "Open MRs", type: "rollup", rollup: { relation: "rm", property: "title", fn: "count", filter: { op: "and", rules: [{ prop: prop("mrs", "State").id, cond: "is", value: "opened" }] } } },
        { id: "lastc", name: "Last comment", type: "rollup", rollup: { relation: "rc", property: prop("jira-comments", "Date").id, fn: "latest" } },
        { id: "opent", name: "Open todos", type: "rollup", rollup: { relation: "rt", property: "title", fn: "count", filter: { op: "and", rules: [{ prop: prop("todos", "Status").id, cond: "is", value: "open" }] } } },
        { id: "runs", name: "Runs", type: "rollup", rollup: { relation: "rr", property: "title", fn: "count" } },
      ],
      views: [],
    },
  });
  for (const t of ["PROJ-1", "PROJ-2", "PROJ-3"]) w.addRow(tickets, { title: t, cells: {} });
  const out = w.rowsOf(tickets)!.rows;
  const cell = (t: string, id: string) => out.find((r) => r.title === t)!.cells[id];
  assert.equal(cell("PROJ-1", "openmrs"), 1, "one of its two MRs is open");
  assert.equal(cell("PROJ-2", "openmrs"), 1);
  assert.equal(cell("PROJ-3", "openmrs"), 0);
  assert.equal(String(cell("PROJ-1", "lastc")).slice(0, 10), "2026-10-17", "the latest Jira comment");
  assert.equal(cell("PROJ-1", "opent"), 2);
  assert.equal(cell("PROJ-2", "opent"), 1);
  assert.equal(cell("PROJ-1", "runs"), 1);
  assert.equal(cell("PROJ-3", "runs"), 0);
});

test("agents learn the sources: workspace_relation_sources lists them with their properties", async () => {
  const { relationSourceHelp } = await import("@/plugins/workspace/source-table");
  const text = relationSourceHelp();
  assert.match(text, /time/);
  assert.match(text, /mrs/);
  assert.match(text, /Ticket/);
});

test("days since a date: the formula the wizard writes counts up for a date in the past", async () => {
  const { daysSinceFormula, evalFormula } = await import("@/plugins/workspace/formula");
  const f = daysSinceFormula("Last comment");
  const r = evalFormula(f, { now: new Date(2026, 9, 19, 12, 0), prop: () => "2026-10-17" });
  assert.deepEqual(r, { value: 2 });
});
