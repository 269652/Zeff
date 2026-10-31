import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Today's page answers "what matters today": the appointments of today and tomorrow morning (with whom — prepare), the todos due
// and overdue (yours), the promises due (yours) or overdue (theirs), and what is new since yesterday (people learned, news).
setupTempData();

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

test("today: appointments of today and tomorrow morning with whom to prepare, due and overdue todos, promises, new since yesterday", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["todos", "calendar", "people", "news"]) setInstalled(id, true);
  const real = new Date();
  const today = dayOf(real);
  const [yesterday, tomorrow, later] = [dayOf(plus(real, -1)), dayOf(plus(real, 1)), dayOf(plus(real, 3))];
  const now = new Date(`${today}T08:00:00`);

  const ir = await import("@/lib/calendar/ir");
  const own = ir.zeffCalendar();
  ir.addEvent(own.id, { title: "Frühstück", start: `${today}T06:00`, end: `${today}T07:00` });
  ir.addEvent(own.id, { title: "Jour fixe mit Erika", start: `${today}T10:00`, end: `${today}T11:00` });
  ir.addEvent(own.id, { title: "Zahnarzt", start: `${tomorrow}T09:00`, end: `${tomorrow}T10:00` });
  ir.addEvent(own.id, { title: "Kino", start: `${tomorrow}T19:00`, end: `${tomorrow}T21:00` });
  ir.proposeEvents(own.id, [{ title: "Block", start: `${today}T12:00`, end: `${today}T13:00` }]);

  const people = await import("@/plugins/people/store");
  const graph = await import("@/plugins/people/graph");
  const erika = people.createPerson({ name: "Erika Mustermann", aliases: ["Erika"] });
  const max = people.createPerson({ name: "Max Muster" });
  graph.addClaim({ personId: erika, kind: "commitment", direction: "mine", text: "Folien schicken", due: today, status: "confirmed" });
  graph.addClaim({ personId: erika, kind: "commitment", direction: "mine", text: "Später mal", due: later, status: "confirmed" });
  graph.addClaim({ personId: max, kind: "commitment", direction: "theirs", text: "Rechnung zahlen", due: yesterday, status: "confirmed" });
  graph.addClaim({ personId: max, kind: "commitment", direction: "theirs", text: "Heute zurückrufen", due: today, status: "confirmed" });
  graph.addClaim({ personId: max, kind: "fact", text: "Spielt Schach", status: "proposed", confidence: 0.6 });

  const store = await import("@/lib/todos/store");
  const { getDb, schema } = await import("@/db");
  const todo = (text: string, due: string | null, extra: Record<string, unknown> = {}) => {
    const id = getDb().insert(schema.todos).values({ ticket: "", text, owner: "me", ...extra } as never).returning().get().id;
    if (due) store.setTodoDue(id, due);
    return id;
  };
  todo("Bericht abgeben", yesterday);
  todo("Steuer zahlen", today);
  todo("Irgendwann", later);
  todo("Ohne Termin", null);
  todo("Auf Antwort warten", today, { owner: "other" });
  todo("Vom Worker", today, { byWorker: true });

  const news = await import("@/plugins/news/store");
  news.addItems({ id: null, name: "Tagesschau" }, [{ guid: "1", url: "https://example.org/1", title: "Neues Gesetz beschlossen", summary: "", publishedAt: new Date().toISOString() }]);

  const { todayData } = await import("@/lib/heute-today");
  const d = await todayData(now);

  assert.deepEqual(
    d.appointments.map((a) => `${a.title}${a.tomorrow ? " (tomorrow)" : ""}${a.proposed ? " (proposed)" : ""}`),
    ["Jour fixe mit Erika", "Block (proposed)", "Zahnarzt (tomorrow)"],
    "not over, not tomorrow afternoon; a proposal marked",
  );
  assert.deepEqual(d.appointments[0].people.map((p) => p.name), ["Erika Mustermann"], "whom to prepare for");
  assert.deepEqual(d.appointments[1].people, []);

  assert.deepEqual(d.due.map((x) => x.text), ["Bericht abgeben", "Steuer zahlen"], "yours, due today or before — the oldest first");

  assert.deepEqual(d.promises.map((p) => `${p.mine ? "mine" : "theirs"}: ${p.text}${p.overdue ? " (overdue)" : ""}`), ["theirs: Rechnung zahlen (overdue)", "mine: Folien schicken"]);

  assert.deepEqual(d.learned.map((c) => `${c.personName}: ${c.text}`), ["Max Muster: Spielt Schach"]);
  assert.equal(d.news?.count, 1);
  assert.deepEqual(d.news?.top.map((n) => n.title), ["Neues Gesetz beschlossen"]);
});

test("today: without the plugins, their sections are empty", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["calendar", "people", "news"]) setInstalled(id, false);
  const { todayData } = await import("@/lib/heute-today");
  const d = await todayData(new Date());
  assert.deepEqual([d.appointments, d.promises, d.learned, d.news], [[], [], [], null]);
});
