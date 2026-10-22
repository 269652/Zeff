import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances", "calendar", "questions", "llm"]) setInstalled(p, true);
}

const ctx = { via: "test" as const };

test("a query is checked against its view before anything runs: unknown views, filters, aggregations and malformed dates are refused with what is allowed", async () => {
  await setup();
  const { validateQuery } = await import("@/plugins/questions/views");
  const bad = (q: unknown) => {
    const r = validateQuery(q, ctx);
    assert.equal(r.ok, false, JSON.stringify(q));
    return r.ok ? "" : r.error;
  };
  assert.match(bad({ view: "drop table time_entries", aggregate: "count" }), /time_entries/, "names the views there are");
  assert.match(bad({ view: "time_entries", aggregate: "explode" }), /sum/);
  assert.match(bad({ view: "time_entries", aggregate: "count", filters: { nonsense: "x" } }), /nonsense/);
  assert.match(bad({ view: "time_entries", aggregate: "count", filters: { from: "letzten Montag" } }), /from/);
  assert.match(bad({ view: "time_entries", aggregate: "sum", measure: "salary" }), /hours/);
  assert.match(bad({ view: "time_entries", aggregate: "count", groupBy: "mood" }), /ticket/);
  // A year or a month stand for their first and last day.
  const ok = validateQuery({ view: "time_entries", aggregate: "sum", filters: [{ name: "from", value: "2026" }, { name: "to", value: "2026-02" }], groupBy: "ticket" }, ctx);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.query.filters.from, "2026-01-01");
    assert.equal(ok.query.filters.to, "2026-02-28");
    assert.equal(ok.query.measure, "hours", "the view's own measure when none is named");
  }
});

test("time entries: the hours per ticket, the most first — with the entries behind them linked", async () => {
  await setup();
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  createJob({ number: "J-1", name: "PROJ" });
  createEntry({ jobNumber: "J-1", date: "2026-03-02", hours: 2, description: "Footer", ticket: "PROJ-1" }, "web");
  createEntry({ jobNumber: "J-1", date: "2026-03-03", hours: 5.5, description: "Suche", ticket: "PROJ-2" }, "web");
  createEntry({ jobNumber: "J-1", date: "2026-03-04", hours: 1, description: "Suche weiter", ticket: "PROJ-2" }, "web");
  createEntry({ jobNumber: "J-1", date: "2025-12-30", hours: 9, description: "Alt", ticket: "PROJ-3" }, "web");
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "time_entries", aggregate: "sum", groupBy: "ticket", filters: { from: "2026" } }, ctx);
  assert.deepEqual(
    r.groups.map((g) => [g.key, g.value]),
    [
      ["PROJ-2", 6.5],
      ["PROJ-1", 2],
    ],
  );
  assert.equal(r.total.value, 8.5);
  assert.equal(r.total.count, 3);
  assert.ok(r.rows.every((x) => x.ref.startsWith("entry:") && x.href?.startsWith("/entries/")));
  assert.match(r.explain, /time_entries/);
  assert.match(r.explain, /2026-01-01/);
});

test("bank transactions (Finances): what went out to the craftsmen in a year — any of several names, signed and absolute", async () => {
  await setup();
  const { addBookings } = await import("@/plugins/cases/bank");
  const b = (date: string, amount: number, counterparty: string, text = "") => ({ date, amount, currency: "EUR", text, counterparty, iban: "", reference: "" });
  addBookings([b("2026-04-01", -320, "Malerbetrieb Huber"), b("2026-06-12", -180.5, "Elektro Kaiser GmbH"), b("2026-06-20", 2500, "Arbeitgeber AG", "Gehalt"), b("2025-11-01", -99, "Malerbetrieb Huber")], "DE01");
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "bank_transactions", aggregate: "sum", measure: "abs", filters: { from: "2026", to: "2026", counterparty: ["maler", "elektro"], direction: "out" } }, ctx);
  assert.equal(r.total.value, 500.5);
  assert.equal(r.total.count, 2);
  const byMonth = await runQuery({ view: "bank_transactions", aggregate: "sum", groupBy: "month", filters: { from: "2026" } }, ctx);
  assert.deepEqual(
    byMonth.groups.map((g) => [g.key, g.value]),
    [
      ["2026-06", 2319.5],
      ["2026-04", -320],
    ],
  );
});

test("calendar events: on how many days I was in the office in October (a series counted per occurrence, declined and cancelled ones left out)", async () => {
  await setup();
  const { createCalendar, addEvent } = await import("@/lib/calendar/ir");
  const cal = createCalendar("Arbeit");
  addEvent(cal.id, { title: "Büro", start: "2026-10-05T09:00", end: "2026-10-05T17:00", allDay: false, location: "Büro Freiburg" } as never);
  addEvent(cal.id, { title: "Standup", start: "2026-10-05T10:00", end: "2026-10-05T10:15", allDay: false, location: "Büro Freiburg" } as never);
  addEvent(cal.id, { title: "Büro", start: "2026-10-07T09:00", end: "2026-10-07T17:00", allDay: false, location: "Büro Freiburg" } as never);
  addEvent(cal.id, { title: "Büro", start: "2026-10-09T09:00", end: "2026-10-09T17:00", allDay: false, location: "Büro Freiburg", cancelled: true } as never);
  addEvent(cal.id, { title: "Büro", start: "2026-11-02T09:00", end: "2026-11-02T17:00", allDay: false, location: "Büro Freiburg" } as never);
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "calendar_events", aggregate: "count_days", filters: { from: "2026-10", to: "2026-10", location: "büro" } }, ctx);
  assert.equal(r.total.value, 2);
  assert.ok(r.rows.every((x) => x.ref.startsWith("event:")));
});

test("messages: when I last wrote with someone — their chat, their mail address and their Teams messages, by the person's names", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  createPerson({ name: "Anna Berg", aliases: ["Anni"], whatsapp: "Anni", emails: ["anna@berg.de"] });
  const { getSqlite } = await import("@/db");
  const d = getSqlite();
  const mail = d.prepare("insert into emails (key, conv_id, folder, from_name, from_email, subject, preview, received_at, synced_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  mail.run("m1", "c1", "Posteingang", "Anna Berg", "anna@berg.de", "Rechnung", "Hier die Rechnung", "2026-09-01T10:00:00Z", "x");
  mail.run("w1", "wa:Anni", "WhatsApp", "Ich", null, "", "Bis morgen!", "2026-10-12T20:15:00Z", "x");
  mail.run("w2", "wa:Bob", "WhatsApp", "Bob", null, "", "Hallo", "2026-10-20T08:00:00Z", "x");
  d.prepare("insert into teams_messages (key, kind, conversation_id, message_id, sender_name, sent_at, html, text, link, synced_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("t1", "pm", "c", "1", "Anna Berg", "2026-10-02T09:00:00Z", "", "Kurze Frage", "https://teams/x", "x");
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "messages", aggregate: "last", filters: { person: "anna" } }, ctx);
  assert.equal(r.total.count, 3);
  assert.equal(r.total.value, "2026-10-12T20:15:00Z");
  const per = await runQuery({ view: "messages", aggregate: "count", groupBy: "channel", filters: { person: "Anna Berg" } }, ctx);
  assert.deepEqual(per.groups.map((g) => g.key).sort(), ["mail", "teams", "whatsapp"]);
});

test("todos: how many are open and done, by status — a merged duplicate not counted", async () => {
  await setup();
  const { getSqlite } = await import("@/db");
  const ins = getSqlite().prepare("insert into todos (ticket, text, status, created_at, done_at, merged_into) values (?, ?, ?, ?, ?, ?)");
  ins.run("PROJ-1", "Footer fixen", "done", "2026-10-01 10:00:00", "2026-10-02 10:00:00", null);
  ins.run("PROJ-1", "Footer testen", "open", "2026-10-03 10:00:00", null, null);
  ins.run("PROJ-2", "Footer testen", "dismissed", "2026-10-03 10:00:00", null, 2);
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "todos", aggregate: "count", groupBy: "status", filters: { from: "2026-10" } }, ctx);
  assert.deepEqual(
    r.groups.map((g) => [g.key, g.value]).sort(),
    [
      ["done", 1],
      ["open", 1],
    ],
  );
});

test("Workspace databases through their own rows: a number summed per option, a date property as the time, the property names checked", async () => {
  await setup();
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const schema = {
    titleName: "Name",
    properties: [
      { id: "d", name: "Datum", type: "date" as const },
      { id: "k", name: "Kategorie", type: "select" as const, options: [{ id: "o1", name: "Handwerker", color: "red" }, { id: "o2", name: "Essen", color: "green" }] },
      { id: "b", name: "Betrag", type: "number" as const, format: "euro" as const },
    ],
    views: [],
  };
  const db = createPage({ kind: "database", title: "Ausgaben", schema });
  addRow(db, { title: "Maler", cells: { d: { start: "2026-03-01" }, k: "o1", b: 300 } });
  addRow(db, { title: "Pizza", cells: { d: { start: "2026-03-02" }, k: "o2", b: 20 } });
  addRow(db, { title: "Fliesen", cells: { d: { start: "2026-05-01" }, k: "o1", b: 150 } });
  addRow(db, { title: "Fliesen alt", cells: { d: { start: "2025-05-01" }, k: "o1", b: 999 } });
  const { runQuery } = await import("@/plugins/questions/views");
  const r = await runQuery({ view: "workspace", aggregate: "sum", measure: "Betrag", groupBy: "Kategorie", filters: { database: "Ausgaben", from: "2026" } }, ctx);
  assert.deepEqual(
    r.groups.map((g) => [g.key, g.value]),
    [
      ["Handwerker", 450],
      ["Essen", 20],
    ],
  );
  assert.ok(r.rows.every((x) => x.href?.startsWith("/workspace/")));
  const where = await runQuery({ view: "workspace", aggregate: "count", filters: { database: String(db), where: [{ prop: "Kategorie", op: "is", value: "essen" }] } }, ctx);
  assert.equal(where.total.count, 1);
  await assert.rejects(runQuery({ view: "workspace", aggregate: "sum", measure: "Gehalt", filters: { database: "Ausgaben" } }, ctx), /Betrag/);
});

test("the sensitivity hook lets work data through (the labels: tests/intel-glue.test.ts); a view another plugin registers is offered and runs like the built-in ones", async () => {
  await setup();
  const v = await import("@/plugins/questions/views");
  assert.equal(v.allowedFor("time_entries", ctx), true, "time entries are open data");
  assert.ok(v.listViews(ctx).some((x) => x.name === "time_entries"));
  v.registerView({ name: "secret_test", description: "x", filters: {}, dims: [], measures: {}, items: () => [{ at: "2026-01-01", title: "geheim", ref: "x:1", values: {}, dims: {} }] });
  assert.ok(v.listViews(ctx).some((x) => x.name === "secret_test"), "a registered view is offered");
  assert.equal((await v.runQuery({ view: "secret_test", aggregate: "count" }, ctx)).total.count, 1);
});

test("asking: the AI routes a numbers question to a query, Zeff runs it, the AI phrases the answer citing the rows — and the query used comes along; a text question goes to the text answer", async () => {
  await setup();
  const { askStructured } = await import("@/plugins/questions/ask");
  const prompts: string[] = [];
  const plan = async (prompt: string) => {
    prompts.push(prompt);
    return { kind: "structured", queries: [{ view: "time_entries", aggregate: "sum", groupBy: "ticket", filters: [{ name: "from", value: "2026" }] }] };
  };
  const phrase = async (prompt: string) => {
    prompts.push(prompt);
    return { answer: "Am meisten Zeit hat PROJ-2 gekostet: 6,5 h [1].", cites: [1] };
  };
  const r = await askStructured("Welche Tickets haben mich 2026 am meisten Zeit gekostet?", [], { plan, phrase, context: ctx });
  assert.equal(r.kind, "structured");
  if (r.kind !== "structured") return;
  assert.match(prompts[0], /time_entries/, "the planner sees the views");
  assert.match(prompts[0], /Welche Tickets/);
  assert.match(prompts[1], /PROJ-2/, "the phrasing sees the numbers");
  assert.match(r.answer.answer, /PROJ-2/);
  assert.equal(r.answer.queries.length, 1);
  assert.match(r.answer.queries[0].explain, /ticket/);
  assert.equal(r.answer.sources[0].n, 1);
  assert.ok(r.answer.sources[0].url.startsWith("/entries/"));

  const text = await askStructured("Wie kommt Code auf die Testumgebung?", [], { plan: async () => ({ kind: "text", queries: [] }), phrase, context: ctx });
  assert.equal(text.kind, "text");
});

test("asking: a plan that does not pass the checks goes back to the AI once with what was wrong; a second bad one falls back to the text answer", async () => {
  await setup();
  const { askStructured } = await import("@/plugins/questions/ask");
  const seen: string[] = [];
  let n = 0;
  const plan = async (prompt: string) => {
    seen.push(prompt);
    n++;
    return n === 1 ? { kind: "structured", queries: [{ view: "time_entries", aggregate: "sum", measure: "salary" }] } : { kind: "structured", queries: [{ view: "time_entries", aggregate: "sum" }] };
  };
  const r = await askStructured("Wie viele Stunden insgesamt?", [], { plan, phrase: async () => ({ answer: "8,5 h", cites: [] }), context: ctx });
  assert.equal(r.kind, "structured");
  assert.match(seen[1], /salary/, "the second try is told what was wrong");
  const bad = await askStructured("Wie viele Stunden?", [], { plan: async () => ({ kind: "structured", queries: [{ view: "nope", aggregate: "sum" }] }), phrase: async () => ({ answer: "", cites: [] }), context: ctx });
  assert.equal(bad.kind, "text");
});

test("MCP ask_structured: a query runs without any AI and comes back as a table with the query used; no arguments lists the views", async () => {
  await setup();
  const { registerQuestionTools } = await import("@/plugins/questions/mcp");
  const tools: Record<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
  const h = { run: async (fn: () => unknown) => fn() as never, ok: (text: string) => ({ content: [{ type: "text", text }] }) as never, fail: (text: string) => ({ content: [{ type: "text", text }], isError: true }) as never };
  registerQuestionTools({ registerTool: (name: string, _m: unknown, fn: never) => void (tools[name] = fn) } as never, h as never);
  const list = await tools.ask_structured({});
  assert.match(list.content[0].text, /time_entries/);
  assert.match(list.content[0].text, /bank_transactions/);
  const r = await tools.ask_structured({ query: { view: "time_entries", aggregate: "sum", groupBy: "ticket", filters: { from: "2026" } } });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /PROJ-2/);
  assert.match(r.content[0].text, /6\.5/);
  const wrong = await tools.ask_structured({ query: { view: "time_entries", aggregate: "nope" } });
  assert.equal(wrong.isError, true);
});

test("the knowledge chat's router: a numbers question comes back as the chat's answer with the queries; a text question, a failing AI or the plugin off leave it to the knowledge", async () => {
  await setup();
  const { chatAnswer } = await import("@/plugins/questions/ask");
  const plan = async () => ({ kind: "structured", queries: [{ view: "time_entries", aggregate: "sum", filters: { from: "2026" } }] });
  const phrase = async () => ({ answer: "8,5 Stunden [1].", cites: [1] });
  const a = await chatAnswer("Wie viele Stunden 2026?", [], { plan, phrase, context: ctx });
  assert.ok(a);
  assert.equal(a!.answer, "8,5 Stunden [1].");
  assert.equal(a!.structured?.queries.length, 1);
  assert.equal(a!.sources.length, 1);
  assert.equal(await chatAnswer("Wie geht Deployment?", [], { plan: async () => ({ kind: "text", queries: [] }), phrase, context: ctx }), null);
  assert.equal(await chatAnswer("Wie viele Stunden?", [], { plan: async () => { throw new Error("no AI"); }, phrase, context: ctx }), null);
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("questions", false);
  assert.equal(await chatAnswer("Wie viele Stunden 2026?", [], { plan, phrase, context: ctx }), null);
  setInstalled("questions", true);
});
