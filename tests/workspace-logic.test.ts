import assert from "node:assert/strict";
import test from "node:test";
import { docRefs, docText, docToMarkdown, markdownToDoc, sanitizeDoc, type DocNode } from "@/plugins/workspace/doc";
import { checkFormula, evalFormula } from "@/plugins/workspace/formula";
import { computeRows, filterRows, groupRows, isComputed, newProperty, normalizeSchema, rollup, rowsToCsv, sortRows, type DbSchema, type Row } from "@/plugins/workspace/model";

const NOW = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct 2026

test("formulas: arithmetic, text, conditions, dates — errors are results, not throws", () => {
  const ctx = { now: NOW, prop: (n: string) => ({ Price: 12.5, Qty: 4, Name: "Zeff", Due: "2026-10-20", Done: true })[n] };
  const val = (s: string) => {
    const r = evalFormula(s, ctx);
    return "error" in r ? `ERR:${r.error}` : r.value;
  };
  assert.equal(val('prop("Price") * prop("Qty")'), 50);
  assert.equal(val('concat(prop("Name"), " ", 2 + 3)'), "Zeff 5");
  assert.equal(val('if(prop("Done"), "yes", "no")'), "yes");
  assert.equal(val('prop("Qty") > 3 and not prop("Done") ? "a" : "b"'), "b");
  assert.equal(val('round(10 / 3, 2)'), 3.33);
  assert.equal(val('dateBetween(prop("Due"), today(), "days")'), 6);
  assert.equal(val('formatDate(dateAdd(prop("Due"), 1, "weeks"), "DD.MM.YYYY")'), "27.10.2026");
  assert.equal(val("1 / 0"), "ERR:Division by zero");
  assert.equal(val("if(true, 1, 1 / 0)"), 1, "only the branch taken is evaluated");
  assert.match(String(val("nope(1)")), /Unknown function/);
  assert.match(String(val("Price")), /prop\("Price"\)/);
  assert.equal(checkFormula('prop("A") +'), "The formula ends too soon");
  assert.equal(checkFormula('prop("A") + 1'), null);
  assert.equal(val('max(1, 5, 3) + sum(1, 2)'), 8);
});

test("documents: text, references, Markdown both ways, and a client's document is cleaned", () => {
  const doc = markdownToDoc("# Title\n\nSome **bold** and a [link](https://example.com) with `code`.\n\n- one\n  - nested\n- [x] done task\n\n1. first\n2. second\n\n> quoted\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n");
  assert.equal(doc.content[0].type, "heading");
  const types = doc.content.map((n) => n.type);
  assert.deepEqual(types, ["heading", "paragraph", "bulletList", "taskList", "orderedList", "blockquote", "codeBlock", "table", "horizontalRule"]);
  assert.match(docText(doc), /Some bold and a link with code\./);
  const md = docToMarkdown(doc);
  assert.match(md, /^# Title/);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(md, /- \[x\] done task/);
  assert.match(md, /```ts\nconst a = 1;\n```/);
  assert.match(md, /\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  // Round trip: the Markdown of the Markdown's document is the same.
  assert.equal(docToMarkdown(markdownToDoc(md)), md);

  const withRefs: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Ask " }, { type: "zeffRef", attrs: { kind: "person", ref: "7", label: "Anna" } }, { type: "text", text: " about ", marks: [{ type: "link", attrs: { href: "/workspace/12" } }] }, { type: "zeffRef", attrs: { kind: "ticket", ref: "PROJ-339", label: "PROJ-339" } }, { type: "zeffRef", attrs: { kind: "person", ref: "7", label: "Anna" } }] },
    ],
  };
  assert.deepEqual(docRefs(withRefs).map((r) => `${r.kind}:${r.ref}`), ["person:7", "page:12", "ticket:PROJ-339"]);
  assert.match(docText(withRefs), /Ask Anna about PROJ-339/);

  const dirty = sanitizeDoc({
    type: "doc",
    content: [
      { type: "script", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }, { type: "onfire" }] }] },
      { type: "image", attrs: { src: "data:text/html;base64,AAAA" } },
      { type: "image", attrs: { src: "/api/workspace/files/abc.png", alt: "ok", onerror: "x" } },
      { type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "h" }] },
    ],
  });
  assert.deepEqual(dirty.content.map((n) => n.type), ["paragraph", "image", "heading"]);
  assert.deepEqual(dirty.content[0].content![0].marks, [{ type: "bold" }], "javascript: links and unknown marks are gone");
  assert.deepEqual(dirty.content[1].attrs, { src: "/api/workspace/files/abc.png", alt: "ok" });
  assert.equal(dirty.content[2].attrs?.level, 3);
  assert.deepEqual(sanitizeDoc("garbage").content, [{ type: "paragraph" }]);
});

function setup() {
  const status = newProperty("Status", "status");
  const tags = { ...newProperty("Tags", "multi_select"), options: [{ id: "t1", name: "Urgent", color: "red" }, { id: "t2", name: "Later", color: "gray" }] };
  const due = newProperty("Due", "date");
  const hours = newProperty("Hours", "number");
  const schema: DbSchema = normalizeSchema({ titleName: "Task", properties: [status, tags, due, hours], views: [] });
  const [todo, doing, done] = status.options!;
  const row = (id: number, title: string, cells: Record<string, unknown>): Row => ({ id, title, icon: "", cells, createdAt: `2026-10-0${id}T10:00:00Z`, updatedAt: `2026-10-1${id}T10:00:00Z` });
  const rows = [
    row(1, "Write docs", { [status.id]: doing.id, [tags.id]: ["t1"], [due.id]: "2026-10-14", [hours.id]: 3 }),
    row(2, "Fix bug", { [status.id]: todo.id, [tags.id]: ["t1", "t2"], [due.id]: "2026-10-20", [hours.id]: 5 }),
    row(3, "Release", { [status.id]: done.id, [due.id]: { start: "2026-10-12", end: "2026-10-16" } }),
    row(4, "Idea", {}),
  ];
  return { schema, rows, status, tags, due, hours, todo, doing, done };
}

test("databases: filters (nested and/or), sorts (empty last), groups", () => {
  const { schema, rows, status, tags, due, hours, doing } = setup();
  const p = schema.properties;
  const labels = { person: (i: number) => `P${i}`, page: (i: number) => `Pg${i}`, todo: (i: number) => `T-${i}`, now: new Date(2026, 9, 14) };
  const ids = (rs: Row[]) => rs.map((r) => r.id);
  assert.deepEqual(ids(filterRows(rows, { op: "and", rules: [{ prop: tags.id, cond: "contains", value: "t1" }, { prop: hours.id, cond: "gt", value: 3 }] }, p, labels)), [2]);
  assert.deepEqual(ids(filterRows(rows, { op: "or", rules: [{ prop: status.id, cond: "is", value: doing.id }, { op: "and", rules: [{ prop: "title", cond: "contains", value: "idea" }] }] }, p, labels)), [1, 4]);
  assert.deepEqual(ids(filterRows(rows, { op: "and", rules: [{ prop: due.id, cond: "this_week" }] }, p, labels)), [1, 3], "a range counts when it touches the week");
  assert.deepEqual(ids(filterRows(rows, { op: "and", rules: [{ prop: due.id, cond: "next_week" }] }, p, labels)), [1, 2, 3]);
  assert.deepEqual(ids(filterRows(rows, { op: "and", rules: [{ prop: tags.id, cond: "is_empty" }] }, p, labels)), [3, 4]);
  assert.deepEqual(ids(sortRows(rows, [{ prop: hours.id, dir: "desc" }], p)), [2, 1, 3, 4], "empty ones last in either direction");
  assert.deepEqual(ids(sortRows(rows, [{ prop: hours.id, dir: "asc" }], p)), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortRows(rows, [{ prop: status.id, dir: "asc" }], p)), [2, 1, 3, 4], "by the option's order");
  const groups = groupRows(rows, tags.id, p, labels);
  assert.deepEqual(groups.map((g) => [g.label, ids(g.rows)]), [["Urgent", [1, 2]], ["Later", [2]], ["No value", [3, 4]]]);
  const byStatus = groupRows(rows, status.id, p, labels);
  assert.deepEqual(byStatus.map((g) => g.label), ["Not started", "In progress", "Done", "No value"]);
});

test("databases: formulas, rollups through relations, back relations — and a circular formula is an error", () => {
  // Projects (db 1) and tasks (db 2): a task points to a project; the project rolls up its tasks' hours and shows them back.
  const hours = newProperty("Hours", "number");
  const project = newProperty("Project", "relation");
  project.relationDb = 1;
  const tasksSchema: DbSchema = normalizeSchema({ titleName: "Task", properties: [hours, project, { id: "cost", name: "Cost", type: "formula", formula: 'prop("Hours") * 80' }], views: [] });
  const tasks: Row[] = [
    { id: 11, title: "Design", icon: "", cells: { [hours.id]: 3, [project.id]: [1] }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    { id: 12, title: "Build", icon: "", cells: { [hours.id]: 5, [project.id]: [1] }, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
    { id: 13, title: "Other", icon: "", cells: { [hours.id]: 9, [project.id]: [2] }, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" },
  ];
  const back = { id: "tasks", name: "Tasks", type: "relation" as const, relationDb: 2, backOf: project.id };
  const total = { id: "total", name: "Total hours", type: "rollup" as const, rollup: { relation: "tasks", property: hours.id, fn: "sum" as const } };
  const cost = { id: "cost", name: "Cost", type: "rollup" as const, rollup: { relation: "tasks", property: "cost", fn: "sum" as const } };
  const loop1 = { id: "l1", name: "L1", type: "formula" as const, formula: 'prop("L2") + 1' };
  const loop2 = { id: "l2", name: "L2", type: "formula" as const, formula: 'prop("L1") + 1' };
  const projSchema: DbSchema = normalizeSchema({ titleName: "Project", properties: [back, total, cost, loop1, loop2], views: [] });
  const projects: Row[] = [
    { id: 1, title: "Relaunch", icon: "", cells: {}, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" },
    { id: 2, title: "Intranet", icon: "", cells: {}, createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" },
  ];
  const lookup = (id: number) => (id === 2 ? { schema: tasksSchema, rows: tasks } : id === 1 ? { schema: projSchema, rows: projects } : null);
  const out = computeRows(projSchema, projects, lookup, 1);
  assert.deepEqual(out[0].cells.tasks, [11, 12], "the back relation lists the tasks pointing here");
  assert.equal(out[0].cells.total, 8);
  assert.equal(out[1].cells.total, 9);
  assert.equal(out[0].cells.cost, 640, "a rollup of the other database's formula");
  assert.equal(out[0].cells["l1!"], "Circular formula");
  assert.equal(projects[0].cells.total, undefined, "the input rows are left as they were");
  const taskOut = computeRows(tasksSchema, tasks, lookup, 2);
  assert.equal(taskOut[0].cells.cost, 240);

  assert.equal(rollup("percent_checked", undefined, [true, false, true, true]), 0.75);
  assert.equal(rollup("median", undefined, [1, 9, 3]), 3);
  assert.equal(rollup("earliest", newProperty("D", "date"), ["2026-10-14", { start: "2026-10-01" }]), "2026-10-01");
  assert.deepEqual(rollup("show_unique", undefined, ["a", "b", "a"]), ["a", "b"]);
});

test("databases: CSV export in the view's order, hidden properties left out", () => {
  const { schema, rows, status, hours, tags } = setup();
  const view = { ...schema.views[0], hidden: [tags.id], order: [hours.id] };
  const csv = rowsToCsv(schema, rows.slice(0, 2), view);
  assert.equal(csv.split("\n")[0], "Task;Hours;Status;Due");
  assert.match(csv, /Write docs;3;In progress;2026-10-14/);
  void status;
});

test("a matching relation links rows by equal values (no stored links) — rollups go through it like through any relation", () => {
  // Tickets (db 1) and booked time (db 2): a ticket's rows are the entries whose Ticket equals its title.
  const hours = { id: "h", name: "Hours", type: "number" as const };
  const ticket = { id: "tk", name: "Ticket", type: "text" as const };
  const timeSchema: DbSchema = normalizeSchema({ titleName: "Description", properties: [hours, ticket], views: [] });
  const at = "2026-10-01T00:00:00Z";
  const entries: Row[] = [
    { id: 21, title: "a", icon: "", cells: { h: 1.5, tk: "PROJ-1" }, createdAt: at, updatedAt: at },
    { id: 22, title: "b", icon: "", cells: { h: 2, tk: "proj-1 " }, createdAt: at, updatedAt: at },
    { id: 23, title: "c", icon: "", cells: { h: 4, tk: "PROJ-2" }, createdAt: at, updatedAt: at },
    { id: 24, title: "d", icon: "", cells: { h: 8 }, createdAt: at, updatedAt: at },
  ];
  const booked = { id: "booked", name: "Booked", type: "relation" as const, relationDb: 2, match: { from: "title", to: "tk" } };
  const total = { id: "total", name: "Hours booked", type: "rollup" as const, rollup: { relation: "booked", property: "h", fn: "sum" as const } };
  const ticketsSchema: DbSchema = normalizeSchema({ titleName: "Ticket", properties: [booked, total], views: [] });
  const tickets: Row[] = [
    { id: 1, title: "PROJ-1", icon: "", cells: {}, createdAt: at, updatedAt: at },
    { id: 2, title: "PROJ-2", icon: "", cells: {}, createdAt: at, updatedAt: at },
    { id: 3, title: "PROJ-3", icon: "", cells: {}, createdAt: at, updatedAt: at },
  ];
  assert.equal(isComputed(booked), true, "its values are not stored");
  const lookup = (id: number) => (id === 2 ? { schema: timeSchema, rows: entries } : id === 1 ? { schema: ticketsSchema, rows: tickets } : null);
  const out = computeRows(ticketsSchema, tickets, lookup, 1);
  assert.deepEqual(out[0].cells.booked, [21, 22], "case and spaces don't matter");
  assert.equal(out[0].cells.total, 3.5);
  assert.equal(out[1].cells.total, 4);
  assert.equal(out[2].cells.total, 0, "nothing booked: 0");
  assert.deepEqual(out[2].cells.booked, []);
  // From a property of this database (a ticket key kept in a text field), to the entries' Ticket.
  const key = { id: "key", name: "Key", type: "text" as const };
  const bySchema: DbSchema = normalizeSchema({ titleName: "Task", properties: [key, { ...booked, match: { from: "key", to: "tk" } }, total], views: [] });
  const tasks: Row[] = [{ id: 5, title: "Relaunch", icon: "", cells: { key: "PROJ-2" }, createdAt: at, updatedAt: at }];
  assert.equal(computeRows(bySchema, tasks, (id) => (id === 2 ? { schema: timeSchema, rows: entries } : null), 9)[0].cells.total, 4);
});

test("a relation can match a source (no database made of it), and a rollup takes only the related rows that pass its filter", () => {
  const at = "2026-10-01T00:00:00Z";
  const hours = { id: "h", name: "Hours", type: "number" as const };
  const ticket = { id: "tk", name: "Ticket", type: "text" as const };
  const type = { id: "ty", name: "Type", type: "text" as const };
  const timeSchema: DbSchema = normalizeSchema({ titleName: "Description", properties: [hours, ticket, type], views: [] });
  const entries: Row[] = [
    { id: 1, title: "a", icon: "", cells: { h: 1, tk: "PROJ-1", ty: "dev" }, createdAt: at, updatedAt: at },
    { id: 2, title: "b", icon: "", cells: { h: 2, tk: "PROJ-1", ty: "meeting" }, createdAt: at, updatedAt: at },
    { id: 3, title: "c", icon: "", cells: { h: 4, tk: "PROJ-2", ty: "dev" }, createdAt: at, updatedAt: at },
  ];
  const booked = { id: "booked", name: "Booked", type: "relation" as const, relationSource: "time", match: { from: "title", to: "tk" } };
  const all = { id: "all", name: "All", type: "rollup" as const, rollup: { relation: "booked", property: "h", fn: "sum" as const } };
  const dev = { id: "dev", name: "Dev", type: "rollup" as const, rollup: { relation: "booked", property: "h", fn: "sum" as const, filter: { op: "and" as const, rules: [{ prop: "ty", cond: "is" as const, value: "dev" }] } } };
  const schema: DbSchema = normalizeSchema({ titleName: "Ticket", properties: [booked, all, dev], views: [] });
  const rows: Row[] = [{ id: 7, title: "PROJ-1", icon: "", cells: {}, createdAt: at, updatedAt: at }];
  const seen: unknown[] = [];
  const out = computeRows(schema, rows, (k) => (seen.push(k), k === "time" ? { schema: timeSchema, rows: entries } : null), 9);
  assert.equal(out[0].cells.all, 3);
  assert.equal(out[0].cells.dev, 1, "the filter keeps only the dev entries");
  assert.deepEqual(out[0].cells.booked, [1, 2]);
  assert.ok(seen.includes("time"), "the source is asked for by its id");
});
