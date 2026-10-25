import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runAi } from "@/lib/ai";
import { parseTodoRecurrence } from "@/lib/calendar/recurrence";
import { errorMessage } from "@/lib/errors";
import { promptText } from "@/lib/prompts";

const { todos } = schema;

/**
 * The words of the repeats, by the AI: an open todo that comes back (a rate every 15th) gets, once, the text its next todos carry —
 * without what only held the first time (“Erste Rate”, “sofort”, a date it was due by, the plan's other payments), with what each
 * payment needs (amount, recipient, case number, purpose). Kept in its rule (`text`); the next todo takes it, and so does every one after.
 * Without it (no AI, it failed) the words' rules do it (repeatText). Server only.
 */

export const INSTRUCTIONS = `Jedes dieser Todos kommt regelmäßig wieder — z. B. eine Rate, die jeden Monat am 15. fällig ist. Wenn es erledigt ist, entsteht das nächste. Schreib für jedes den Text, den die WIEDERHOLUNGEN tragen (das nächste und jedes weitere Todo).

- Lass weg, was nur fürs erste Mal gilt: „erste Rate“, „Anzahlung“, „sofort“, „heute“, „zunächst“, ein festes Datum, bis zu dem es fällig war (das Fälligkeitsdatum steht am Todo), und Angaben über den ganzen Plan (Folgeraten, Laufzeit, Schlusszahlung, was passiert, wenn man in Rückstand gerät).
- Behalte, was jede Zahlung braucht: Betrag, Empfänger, Aktenzeichen bzw. Verwendungszweck, Konto.
- Kurz, als Aufgabe formuliert, in der Sprache des Todos (z. B. „Rate 300 € (Az. DR II 1121/26) an die Gerichtsvollzieherin überweisen“).
- Passt der Text schon für jede Wiederholung, gib ihn unverändert zurück.
- Erfinde nichts dazu.`;

const SCHEMA = {
  type: "object",
  properties: { todos: { type: "array", items: { type: "object", properties: { id: { type: "number" }, text: { type: "string" } }, required: ["id", "text"] } } },
  required: ["todos"],
};

/** At most this many in one go (the next run takes the rest). */
const BATCH = 20;

/** The open todos with a rule and no words of the repeats yet (or just these). */
function waiting(ids?: number[]) {
  return getDb()
    .select({ id: todos.id, text: todos.text, due: todos.due, recurrence: todos.recurrence })
    .from(todos)
    .where(and(eq(todos.status, "open"), isNotNull(todos.recurrence)))
    .all()
    .filter((t) => (!ids || ids.includes(t.id)) && !parseTodoRecurrence(t.recurrence)?.text)
    .slice(0, BATCH);
}

/** Writes the words of the repeats for the open recurring todos that have none yet. How many got theirs; an AI that fails leaves them be. */
export async function writeRepeatTexts(ids?: number[]): Promise<{ written: number; error?: string }> {
  const list = waiting(ids);
  if (!list.length) return { written: 0 };
  const prompt = [promptText("repeat-text", INSTRUCTIONS), "", "# Todos", ...list.map((t) => JSON.stringify({ id: t.id, text: t.text, due: t.due }))].join("\n");
  let answer: { todos?: { id?: number; text?: string }[] } | null;
  try {
    answer = (await runAi<{ todos?: { id?: number; text?: string }[] }>(prompt, SCHEMA, { task: "repeat-text", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output ?? null;
  } catch (e) {
    return { written: 0, error: errorMessage(e) };
  }
  let written = 0;
  for (const a of answer?.todos ?? []) {
    const t = list.find((x) => x.id === a.id);
    const text = (a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const rule = t ? parseTodoRecurrence(t.recurrence) : null;
    if (!t || !rule || !text) continue;
    getDb().update(todos).set({ recurrence: JSON.stringify({ ...rule, text }) }).where(eq(todos.id, t.id)).run();
    written++;
  }
  return { written };
}
