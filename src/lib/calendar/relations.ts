/**
 * The Termin-Zuordnung (the Calendar's step for Todos, after the briefing): each open todo gets the
 * appointments it is about — those of the last two weeks and the next month, in every calendar. With
 * many appointments the likeliest few per todo come first (shared words of the todo and the
 * appointment's title, place and description), then the AI picks by content. They become the todo's
 * related appointments ("cal:<id>", with its related mails and notes): shown at it, in its context.
 * Server only.
 */
import { promptText } from "@/lib/prompts";
import { plain } from "@/lib/runs/collect";
import type { TodoView } from "@/lib/todos/shared";
import { listTodos, setTodoCalendarRefs } from "@/lib/todos/store";
import { getJiraTicket } from "@/lib/jira/store";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { promptRoom, relateInBatches, relateJob } from "@/lib/ai/batch-job";
import { eventsBetween } from "./ir";
import { calendarRef } from "./brief";
import { dayOf } from "./ir-shared";

const PER_TODO = 6;
const BATCH_CHARS = COPILOT_MAX_PROMPT - 4000;
/** The appointments looked at: this many days back and ahead. */
const DAYS_BACK = 14;
const DAYS_AHEAD = 30;

const SCHEMA = {
  type: "object",
  properties: {
    todos: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, appointments: { type: "array", items: { type: "string" } } }, required: ["id", "appointments"] } },
  },
  required: ["todos"],
};

export const INSTRUCTIONS = `Du ordnest Termine meinen offenen Todos zu. Unten steht je Todo (Nummer in eckigen Klammern) eine Auswahl von Terminen aus meinem Kalender (Kennung in eckigen Klammern, z. B. [cal:12], dazu Datum, Titel, Ort und Beschreibung).

Gib für JEDES Todo die Kennungen der Termine an, die für genau dieses Todo relevant sind: zu denen es gehört (es ist die Vor- oder Nachbereitung, etwas, das dort mitzubringen, abzugeben oder zu klären ist), die seinen Zeitpunkt festlegen oder die man kennen muss, um es zu erledigen. Nicht schon deshalb, weil ein Termin am selben Tag liegt oder ähnlich klingt. Gehört kein Termin dazu, gib eine leere Liste an.`;

const STOP = new Set(
  "aber alle allem also auch dann dass dein deine denn diese dieser dies doch durch eine einem einen einer eines etwas für habe haben hast hier ihre ihren immer jetzt kann kein keine machen mehr mein meine mich nach noch nicht nur oder sein sind soll über und unter von war weil wenn werden wieder wird wir wollen zum zur with that this from have your".split(" "),
);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

type Appt = { ref: string; day: string; time: string; title: string; place: string; text: string; w: Set<string> };

/** The appointments to match against: not cancelled, each once (a series' occurrences share their ref), the nearest first. */
function appointments(now = new Date()): Appt[] {
  const from = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BACK));
  const to = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD));
  const today = dayOf(now);
  // One appointment per series: the same title at the same time of day are occurrences of one (Outlook keeps each as its own row).
  const bySeries = new Map<string, Appt>();
  for (const e of eventsBetween(from, to)) {
    if (e.cancelled) continue;
    const ref = calendarRef(e.id);
    const day = (e.occurrence ?? e.start).slice(0, 10);
    const time = e.allDay ? "ganztägig" : e.start.slice(11, 16);
    const series = `${e.title.trim().toLowerCase()}|${time}|${e.location.trim().toLowerCase()}`;
    const prev = bySeries.get(series);
    // The occurrence nearest to today stands for the series.
    if (prev && Math.abs(Date.parse(prev.day) - Date.parse(today)) <= Math.abs(Date.parse(day) - Date.parse(today))) continue;
    bySeries.set(series, { ref, day, time, title: e.title, place: e.location, text: e.description, w: words(`${e.title} ${e.location} ${e.description}`) });
  }
  return [...bySeries.values()];
}

/** The appointments likeliest to be about a todo: most shared words (at least two), the best few. */
function candidates(todo: TodoView, list: Appt[]): Appt[] {
  const summary = todo.ticket ? (getJiraTicket(todo.ticket)?.summary ?? "") : "";
  const tw = words(`${todo.text} ${summary} ${todo.note ?? ""}`);
  if (!tw.size) return [];
  return list
    .map((a) => ({ a, score: [...tw].filter((x) => a.w.has(x)).length }))
    .filter((x) => x.score >= 2)
    .sort((x, y) => y.score - x.score || x.a.day.localeCompare(y.a.day))
    .slice(0, PER_TODO)
    .map((x) => x.a);
}

const line = (a: Appt) => `  - [${a.ref}] ${a.day} ${a.time} „${plain(a.title, 160)}“${a.place ? ` (${plain(a.place, 80)})` : ""}${a.text ? ` — ${plain(a.text, 400)}` : ""}`;
const block = (t: TodoView, list: Appt[]) => [`## [${t.id}] ${plain(t.text, 300)}${t.ticket ? ` (${t.ticket})` : ""}`, ...list.map(line)].join("\n");

export type CalendarRelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

export function relateAppointments(): Promise<CalendarRelationResult> {
  return relateJob("__zeffCalendarRelations", "calendar-relations", async () => {
    const open = listTodos({ status: "open" });
    const list = appointments();
    const picks = new Map<number, string[]>();
    const groups: { t: TodoView; list: Appt[] }[] = [];
    for (const t of open) {
      const c = candidates(t, list);
      if (c.length) groups.push({ t, list: c });
      else picks.set(t.id, []); // nothing likely: no appointments
    }
    // A batch that fails: its todos keep the appointments they have.
    const { batches, failed } = await relateInBatches({
      task: "calendar-relations",
      groups,
      block: (g) => block(g.t, g.list),
      room: promptRoom(BATCH_CHARS),
      prompt: (blocks) => `${promptText("calendar-relations", INSTRUCTIONS)}\n\n${blocks}`,
      schema: SCHEMA,
      field: "appointments",
      take: (g, said) => {
        const known = new Set(g.list.map((a) => a.ref));
        const refs = (said.get(g.t.id) ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (known.has(r) ? r : `cal:${r}`));
        picks.set(g.t.id, refs.filter((r) => known.has(r)).slice(0, 4));
      },
    });
    const changed = setTodoCalendarRefs(picks);
    return { todos: picks.size, changed, batches, failed };
  });
}
