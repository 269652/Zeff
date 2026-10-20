import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Todos about the same case — the same Aktenzeichen (DR II 810/26) — are one: the newer information (its text, its deadline, its action)
 * replaces what the older said; the older one stays as a note. Whatever makes the todo (the gate), and the duplicates already there.
 */
test("the case numbers in a text: court and authority references, written as in letters", async () => {
  const { caseRefs } = await import("@/lib/boards/similar");
  assert.deepEqual(caseRefs("Restforderung 11,52 € (Az. DR II 810/26) heute überweisen"), ["DR II 810/26"]);
  assert.deepEqual(caseRefs("Erste Rate (Az. DR II 1121/26, Sparkasse) und Verwendungszweck „DR II 1121/26“"), ["DR II 1121/26"]);
  assert.deepEqual(caseRefs("Am 15.11.2026 und 3/4 der Rate zahlen"), [], "dates and fractions are no case numbers");
  assert.deepEqual(caseRefs("Rechnung 4711 bezahlen"), []);
});

test("a new todo about the same case replaces the open one's text, deadline and action — the old wording stays as a note", async () => {
  const { addDocTodo, getTodo, listTodos } = await import("@/lib/boards/store");
  const mk = (text: string, due: string | null) => addDocTodo({ ticket: "KB-2", text, kind: "other", refs: [], runId: null, due });
  const old = await mk("Restforderung 11,52 € (Az. DR II 810/26) heute auf das Dienstkonto überweisen", "2026-10-20");
  const fresh = await mk("Rate von 50,00 € (Az. DR II 810/26) bis 15.11.2026 überweisen, danach monatlich", "2026-11-15");
  assert.equal(fresh.id, old.id, "one todo, the older keeps its id");
  const t = getTodo(old.id)!;
  assert.match(t.text, /Rate von 50,00/, "the newer text");
  assert.equal(t.due, "2026-11-15", "the newer deadline, not the earlier one");
  assert.ok(t.userNotes.some((n) => /Restforderung 11,52/.test(n.text)), "the old wording is kept as a note");
  assert.equal(listTodos({ status: "open" }).filter((x) => /810\/26/.test(x.text)).length, 1);
  // Another case is another todo.
  const other = await mk("Erste Rate 300,00 € (Az. DR II 1121/26) überweisen", "2026-10-20");
  assert.notEqual(other.id, old.id);
});

test("the duplicates already there are merged by their case number: the survivor takes the newer one's information", async () => {
  const { addManualTodo, getTodo, listTodos } = await import("@/lib/boards/store");
  const { mergeDuplicateTodos } = await import("@/lib/boards/dedupe");
  const { getDb, schema } = await import("@/db");
  const a = addManualTodo({ ticket: "KB-9", text: "Mahnung (Az. AG 55/26) heute bezahlen" });
  // (Made before the gate knew case numbers: a second row inserted past it.)
  const { id: _id, ...row } = getDb().select().from(schema.todos).all().find((x) => x.id === a.id)!;
  const b = getDb().insert(schema.todos).values({ ...row, text: "Vergleich mit Ratenzahlung vereinbaren, Az. AG 55/26, ab dem 1.12." }).returning().get();
  const r = mergeDuplicateTodos();
  assert.ok(r.merged >= 1);
  const open = listTodos({ status: "open" }).filter((x) => /55\/26/.test(x.text));
  assert.equal(open.length, 1);
  assert.equal(open[0].id, a.id);
  assert.match(getTodo(a.id)!.text, /Vergleich mit Ratenzahlung/, "the newer text");
  void b;
});
