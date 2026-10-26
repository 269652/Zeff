/**
 * Appointments as todos: in a calendar set so ("Todos" — Zeff's own by default), each appointment of
 * today and tomorrow that has something for you to do becomes a todo on its day — a series' occurrence
 * on its own day, once. Whether it has (a blocker like "Pause 12:30" has not) the AI says, once per
 * appointment or series (calendar-todos); without the AI plugin each one is a todo. Ticking it off
 * leaves the appointment as it is. Server only.
 */
import { addCalendarTodo, getTodo, setTodoDue, setTodoStatus, todoByRef } from "@/lib/boards/store";
import { getPref, setPref } from "@/lib/prefs";
import { eventsBetween } from "./ir";
import { dayOf, type CalendarEventView } from "./ir-shared";

export const INSTRUCTIONS = `Du gehst Termine aus meinem Kalender durch und entscheidest für jeden, ob er mir etwas zu tun gibt — nur dann wird er ein Todo an seinem Tag.

- Ein Todo, wenn ich etwas TUN muss: etwas erledigen, vorbereiten, mitbringen, besorgen, anrufen, schicken, bezahlen, hingehen und dort etwas abgeben oder klären („Kleider waschen“, „Müll rausbringen“, „Geschenk für Anna besorgen“, „Steuererklärung abgeben“, „Arzttermin — Überweisung mitnehmen“).
- KEIN Todo für: Zeitblocker und Routinen, die nur Zeit freihalten („Pause“, „Mittag“, „Fokuszeit“, „Blocker“, „Gym“, „Pendeln“, „Feierabend“, „Standup“, „Daily“), Erinnerungen ohne Aufgabe („Geburtstag Nadine“ — außer es steht dabei, dass ich etwas tun soll), Feiertage, Urlaub, Abwesenheiten, und Besprechungen, zu denen ich nur erscheine.
- Im Zweifel bei einem Termin, der nach einer Aufgabe klingt: ein Todo.
- \`text\`: die Aufgabe, kurz, in der Sprache des Termins (meist einfach sein Titel; ohne Uhrzeit, die kommt dazu).`;

const SCHEMA = {
  type: "object",
  properties: {
    appointments: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, todo: { type: "boolean" }, text: { type: "string" } }, required: ["id", "todo"] },
    },
  },
  required: ["appointments"],
};

/** The AI's word on an appointment (a series: all of it), kept — asked again only when its title or place changes. */
type Verdict = { todo: boolean; text?: string; at: string };
const VERDICTS = "calendar:todo-verdicts";
/** At most this many asked in one go (the next run asks the rest). */
const BATCH = 40;

type Due = CalendarEventView & { calendar: { name: string } };
const verdictKey = (e: Due) => `${e.seriesId ?? e.id}|${e.title.trim()}|${e.location.trim()}`;

/** The AI's verdicts for the appointments it hasn't judged yet (null: no AI, or it failed — each one is a todo then). */
async function judge(list: Due[]): Promise<Record<string, Verdict> | null> {
  const all = getPref<Record<string, Verdict>>(VERDICTS, {});
  const ask = [...new Map(list.filter((e) => !all[verdictKey(e)]).map((e) => [verdictKey(e), e])).values()].slice(0, BATCH);
  if (!ask.length) return all;
  if (!(await import("@/plugins/state")).isInstalled("llm")) return null;
  const { promptText } = await import("@/lib/prompts");
  const { runAi } = await import("@/lib/ai");
  const lines = ask.map((e, i) =>
    JSON.stringify({
      id: String(i),
      title: e.title,
      when: e.allDay ? "ganztägig" : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`,
      repeats: !!(e.recurrence || e.seriesId),
      calendar: e.calendar.name,
      ...(e.location ? { location: e.location } : {}),
      ...(e.description ? { notes: e.description.slice(0, 600) } : {}),
      ...(e.attendees.length ? { attendees: e.attendees.length } : {}),
    }),
  );
  const prompt = [promptText("calendar-todos", INSTRUCTIONS), "", "# Termine", ...lines].join("\n");
  let answer: { appointments?: { id?: string; todo?: boolean; text?: string }[] } | null;
  try {
    answer = (await runAi<typeof answer>(prompt, SCHEMA, { task: "calendar-todos", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output ?? null;
  } catch (e) {
    console.warn("[calendar] Termine nicht geprüft:", e instanceof Error ? e.message : e);
    return null;
  }
  const at = new Date().toISOString();
  for (const a of answer?.appointments ?? []) {
    const e = ask[Number(a.id)];
    if (!e || typeof a.todo !== "boolean") continue;
    const text = (a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    all[verdictKey(e)] = { todo: a.todo, ...(text ? { text } : {}), at };
  }
  setPref(VERDICTS, all);
  return all;
}

/** The todos for today's and tomorrow's appointments that give you something to do (those not made yet). How many were made. */
export async function calendarTodos(now = new Date()): Promise<number> {
  const from = dayOf(now);
  const to = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const due: (Due & { day: string })[] = [];
  for (const e of eventsBetween(from, to)) {
    if (!e.calendar.todos || e.cancelled) continue;
    const day = (e.occurrence ?? e.start).slice(0, 10);
    // One that began before (several days long) had its todo on its first day.
    if (day < from || day >= to) continue;
    // Made for a todo (a proposal accepted): that todo is it — it's due then, no second one.
    if (e.todoId) {
      const t = getTodo(e.todoId);
      if (t && t.status === "open" && !t.due) setTodoDue(t.id, day);
      continue;
    }
    due.push({ ...e, day });
  }
  const verdicts = due.length ? await judge(due) : {};
  let added = 0;
  for (const e of due) {
    // Which appointment on which day: a series and its moved occurrences share one.
    const ref = `event:${e.seriesId ?? e.id}@${e.day}`;
    const v = verdicts?.[verdictKey(e)];
    if (verdicts && !v) continue; // not judged yet (beyond this run's batch): the next run
    if (v && !v.todo) {
      // Nothing to do: its todo made before (by the time the AI said so) goes, while untouched.
      const made = todoByRef(ref);
      if (made && made.status === "open" && made.source?.startsWith("Kalender")) setTodoStatus(made.id, "dismissed");
      continue;
    }
    const what = v?.text || e.title;
    const text = e.allDay ? what : `${what} (${e.start.slice(11, 16)})`;
    if (addCalendarTodo({ text, due: e.day, ref, source: `Kalender „${e.calendar.name}“` })) added++;
  }
  return added;
}

/** The calendar todos when due (every 15 minutes, in each account with the Kalender installed). */
export async function calendarTodosWhenDue(): Promise<void> {
  if (!(await import("@/plugins/state")).isInstalled("calendar")) return;
  const last = getPref<number>("calendar:todos-at", 0);
  if (Date.now() - last < 15 * 60000) return;
  setPref("calendar:todos-at", Date.now());
  const n = await calendarTodos();
  if (n) console.log(`[calendar] ${n} Todo${n === 1 ? "" : "s"} aus Terminen`);
}
