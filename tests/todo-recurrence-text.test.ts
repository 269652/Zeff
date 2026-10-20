import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * After an evaluation the open todos whose text says they come back (“danach jeweils 300 € am 15. von 15.11.2026 bis 15.09.2027”) get
 * their rule by themselves: the repeats' first day, their last day, the series in the calendar.
 */
const T125 =
  "Erste Rate von 300,00 € (Az. DR II 1121/26, Sparkasse-Vollstreckung) heute auf das Dienstkonto der Gerichtsvollzieherin (IBAN DE22 6609 0800 0007 7773 02, Verwendungszweck „DR II 1121/26“) überweisen; danach jeweils 300 € am 15. von 15.11.2026 bis 15.09.2027 zahlen und die 13. Zahlung am 15.10.2027 nach schriftlicher Mitteilung des Restbetrags (Rückstand über zwei Wochen macht den Plan hinfällig).";

test("the rule a todo's text names: monthly on the 15th, from 15.11.2026 to 15.09.2027 — after a one-off today", async () => {
  const { recurrenceFromText } = await import("@/lib/boards/recurrence-text");
  const r = recurrenceFromText(T125, "2026-10-20")!;
  assert.equal(r.freq, "monthly");
  assert.equal(r.start, "2026-11-15");
  assert.equal(r.until, "2027-09-15");
});

test("other ways to say it: every month, every week, yearly; and nothing where the text names no repetition", async () => {
  const { recurrenceFromText } = await import("@/lib/boards/recurrence-text");
  assert.equal(recurrenceFromText("Miete jeden Monat am 3. überweisen", "2026-10-20")!.start, "2026-11-03", "the next 3rd after the due day");
  assert.equal(recurrenceFromText("Rate monatlich zahlen", "2026-10-20")!.start, undefined, "the due day itself starts it");
  assert.equal(recurrenceFromText("Bericht jede Woche abgeben", "2026-10-20")!.freq, "weekly");
  assert.equal(recurrenceFromText("Gebühr jährlich bezahlen", "2026-10-20")!.freq, "yearly");
  assert.equal(recurrenceFromText("Erste Rate heute überweisen, die zweite am 15.11.", "2026-10-20"), null, "two payments are no repetition");
  assert.equal(recurrenceFromText("Dokument prüfen und zurücksenden", "2026-10-20"), null);
});

test("after an evaluation: the open todos that name a repetition get their rule, the series and the one-off — once; a rule set by hand stays", async () => {
  const { addManualTodo, getTodo, setTodoDue } = await import("@/lib/boards/store");
  const { detectRecurrences, setRecurrence } = await import("@/lib/boards/recurring");
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const a = addManualTodo({ ticket: "KB-2", text: T125 });
  setTodoDue(a.id, "2026-10-20");
  const b = addManualTodo({ ticket: "KB-2", text: "Abo jährlich kündigen" });
  setTodoDue(b.id, "2026-12-01");
  setRecurrence(b.id, { freq: "daily", interval: 1 });
  const r = detectRecurrences();
  assert.equal(r.set, 1);
  assert.equal(getTodo(a.id)!.recurrence!.start, "2026-11-15");
  assert.equal(getTodo(b.id)!.recurrence!.freq, "daily", "yours stays");
  const days = eventsBetween("2026-10-01", "2027-12-01").filter((e) => e.todoId === a.id).map((e) => e.start.slice(0, 10));
  assert.equal(days[0], "2026-10-20");
  assert.equal(days.length, 1 + 11, "the one-off and the 11 repeats to 15.09.2027 (15.11. … 15.09.)");
  assert.equal(detectRecurrences().set, 0, "once");
});
