import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("Agenda: a page with projects and notes; its screen draws, and its scopes pick the right notes", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("agenda", true);
  const { agendaPage } = await import("@/plugins/agenda/template");
  const { getPage, rowsOf, children } = (await import("@/plugins/workspace/store")) as typeof import("@/plugins/workspace/store") & { children?: never };
  void children;
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { AGENDA_VIEW } = await import("@/plugins/agenda/view-template.meta");
  const { getSqlite } = await import("@/db");
  const root = agendaPage(null);
  const dbs = getSqlite().prepare("select id, title from ws_pages where parent_id = ? and kind = 'database' order by id").all(root) as { id: number; title: string }[];
  assert.equal(dbs.length, 2);
  const notes = rowsOf(dbs[1].id)!;
  assert.equal(notes.rows.length, 3);
  const view = notes.schema.views[0];
  assert.equal(view.app, "agenda");
  assert.equal(notes.schema.dataType, "agenda");
  const draw = (state: Record<string, string>) => renderView(view.template!, { rows: notes.rows, props: notes.schema.properties, titleName: notes.schema.titleName, state, app: {}, db: { id: dbs[1].id, title: "Notes" } }, { parts: AGENDA_VIEW.parts });
  const all = draw({});
  assert.deepEqual(all.errors, []);
  const timeline = (r: ReturnType<typeof draw>) => {
    const find = (l: unknown[]): { c: unknown[] } | null => {
      for (const n of l as ({ t: string; c: unknown[] } | string)[]) {
        if (typeof n === "string") continue;
        if (n.t === "timeline") return n;
        const inner = find(n.c);
        if (inner) return inner;
      }
      return null;
    };
    return find(r.nodes)!.c.filter((x) => typeof x !== "string").length;
  };
  assert.equal(timeline(all), 3, "all open notes");
  assert.equal(timeline(draw({ scope: "agenda" })), 2, "on the agenda");
  assert.equal(timeline(draw({ scope: "today" })), 1, "today");
  assert.equal(timeline(draw({ scope: "done" })), 0);
  // A project whose notes are all done isn't offered — only under Done.
  const { addRow } = await import("@/plugins/workspace/store");
  const props = notes.schema.properties;
  const pid = (name: string) => props.find((x) => x.name === name)!.id;
  const old = addRow(dbs[0].id, { title: "Old project" });
  const project = props.find((x) => x.type === "relation")!;
  addRow(dbs[1].id, { title: "Finished", cells: { [project.id]: [old], [pid("Done")]: true } });
  const again = rowsOf(dbs[1].id)!;
  // The sidebar's projects: by category; one whose notes are all done isn't offered (as in Agenda), the archived ones neither.
  void again;
  const { agendaData } = await import("@/plugins/agenda/data");
  const data = await agendaData(dbs[1].id);
  assert.deepEqual(data.projects.map((p) => [p.title, p.open]), [["Getting started", 3]]);
  assert.equal(data.upgraded, false, "a new Agenda is up to date");
  // The screen: the sidebar with the overviews and the projects, filters by tag and person.
  const screen = draw({});
  const kinds: string[] = [];
  const walk = (l: unknown[]) => (l as ({ t: string; c: unknown[] } | string)[]).forEach((n) => typeof n !== "string" && (kinds.push(n.t), walk(n.c)));
  walk(screen.nodes);
  assert.ok(kinds.includes("nav"));
  assert.equal(kinds.filter((k) => k === "facets").length, 0, "no tags, no people yet: no filters for them");
  assert.ok(getPage(root));
});

test("Agenda: a note's checklist becomes Zeff todos (ticked from either side); a list switched off and the example's stay out", async () => {
  const { agendaPage } = await import("@/plugins/agenda/template");
  const { addRow, getPage, updatePage } = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { todoByRef, setTodoStatus } = await import("@/lib/todos/store");
  const { syncPageLists, blockTodoDone } = await import("@/plugins/workspace/task-lists");
  const { getSqlite } = await import("@/db");
  const root = agendaPage(null);
  const notes = (getSqlite().prepare("select id from ws_pages where parent_id = ? and kind = 'database' order by id").all(root) as { id: number }[])[1].id;
  const items = (id: number) => {
    const out: { itemId: string; checked: boolean }[] = [];
    const walk = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => (n.type === "taskItem" && out.push({ itemId: String(n.attrs?.itemId), checked: n.attrs?.checked === true }), (n.content ?? []).forEach((c) => walk(c as never)));
    walk(getPage(id)!.content as never);
    return out;
  };
  const before = (getSqlite().prepare("select count(*) n from todos").get() as { n: number }).n;
  assert.equal(before, 0, "the example's checklist made no todos");

  const note = addRow(notes, { title: "Einkauf" });
  updatePage(note, { content: markdownToDoc("- [ ] Milch kaufen\n- [ ] Brot holen") });
  syncPageLists(note);
  const [milk, bread] = items(note);
  const todo = todoByRef(`bt:${milk.itemId}`);
  assert.equal(todo?.text, "Milch kaufen");
  assert.equal(todo?.status, "open");

  // Done in the Todos: the note's box is ticked.
  setTodoStatus(todo!.id, "done", "test");
  blockTodoDone(todo!.id);
  assert.equal(items(note)[0].checked, true);
  assert.ok(todoByRef(`bt:${bread.itemId}`));

  // A list switched off: no todos.
  const off = addRow(notes, { title: "Nur Notiz" });
  const doc = markdownToDoc("- [ ] nur für mich");
  updatePage(off, { content: { ...doc, content: (doc.content ?? []).map((n) => (n.type === "taskList" ? { ...n, attrs: { engine: false } } : n)) } });
  syncPageLists(off);
  assert.ok(!todoByRef(`bt:${items(off)[0].itemId}`));
});

test("todo marks: a row that flowed into todos — by its source (a mail), itself, its checklist, its ticket; dismissed ones don't count", async () => {
  const { createPage, addRow, getPage, updatePage, rowsOf } = await import("@/plugins/workspace/store");
  const { todoMarks } = await import("@/plugins/workspace/todo-marks");
  const { getSqlite } = await import("@/db");
  const db = createPage({ parentId: null, title: "Marks", kind: "database", schema: { titleName: "Title", properties: [], views: [] } });
  const mail = addRow(db, { title: "Mail" });
  getSqlite().prepare("update ws_pages set props = json_set(props, '$.srcref', 'mail:abc') where id = ?").run(mail);
  const self = addRow(db, { title: "Selbst" });
  const ticket = addRow(db, { title: "Ticket" });
  getSqlite().prepare("update ws_pages set props = json_set(props, '$.ticketkey', 'ABC-1') where id = ?").run(ticket);
  const note = addRow(db, { title: "Notiz" });
  updatePage(note, { content: { type: "doc", content: [{ type: "taskList", attrs: { listId: "tl1" }, content: [{ type: "taskItem", attrs: { checked: false, itemId: "itm1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] } as never });
  const plain = addRow(db, { title: "Nichts" });
  const at = new Date().toISOString();
  const add = (refs: string[], status = "open", ticketKey = "") => getSqlite().prepare("insert into todos (ticket, text, kind, owner, status, source, refs, created_at, updated_at) values (?, ?, 'other', 'me', ?, 'test', ?, ?, ?)").run(ticketKey, `T ${refs.join(",")}`, status, JSON.stringify(refs), at, at);
  add(["mail:abc"]);
  add(["mail:abc"], "done");
  add(["mail:abc"], "dismissed");
  add([`ws:${self}`], "done");
  add(["bt:itm1"]);
  add([], "open", "ABC-1");
  void getPage;
  const m = todoMarks(rowsOf(db)!.rows, db);
  assert.deepEqual([m[mail]?.n, m[mail]?.open], [2, 1], "two of the mail's, one open; the dismissed one not");
  assert.deepEqual([m[self]?.n, m[self]?.open], [1, 0]);
  assert.equal(m[note]?.n, 1);
  assert.equal(m[ticket]?.n, 1);
  assert.equal(m[plain], undefined);
});

test("Agenda: an older one is brought up to date — its type, a reminder, its screen; a note with a reminder is a todo of that day", async () => {
  const { createPage, addRow, setCell, getDatabase } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const { ensureAgenda } = await import("@/plugins/agenda/upgrade");
  const { todoByRef } = await import("@/lib/todos/store");
  const { syncDatabase } = await import("@/plugins/workspace/todo-engine");
  // As the first version made it: no data type, its screen a view of any table.
  const projects = createPage({ parentId: null, title: "Projects", kind: "database", schema: { titleName: "Project", properties: [], views: [newView("Table", "table")] } });
  const props = [newProperty("Date", "date"), { ...newProperty("Project", "relation"), relationDb: projects }, newProperty("On the agenda", "checkbox"), newProperty("Pinned", "checkbox"), newProperty("Done", "checkbox"), newProperty("Tags", "multi_select")];
  const db = createPage({ parentId: null, title: "Notes", kind: "database", schema: { titleName: "Note", properties: props, views: [{ ...newView("Agenda", "app"), app: "template", template: '<part name="agenda.new" date="Date"/><list source="rows">{{ title }}</list>' }] } });
  assert.equal(ensureAgenda(db), true);
  const d = getDatabase(db)!;
  assert.equal(d.schema.dataType, "agenda");
  assert.equal(d.schema.views[0].app, "agenda");
  assert.ok(d.schema.views[0].template!.includes('<state name="v"'), "its screen redrawn");
  const reminder = d.schema.properties.find((p) => p.name === "Reminder")!;
  assert.equal(reminder.type, "date");
  assert.equal(ensureAgenda(db), false, "once is enough");

  const plain = addRow(db, { title: "Nur eine Notiz" });
  const remind = addRow(db, { title: "Zahnarzt anrufen" });
  setCell(remind, reminder.id, "2026-11-20T09:00");
  syncDatabase(db);
  assert.ok(!todoByRef(`ws:${plain}`), "a note without a reminder is no todo");
  assert.equal(todoByRef(`ws:${remind}`)?.due, "2026-11-20");
  setCell(remind, reminder.id, null);
  syncDatabase(db);
  assert.equal(todoByRef(`ws:${remind}`)?.status, "dismissed", "its reminder taken away: out of the Todos");
});
