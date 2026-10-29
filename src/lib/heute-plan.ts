/**
 * "Plan my day" (the Today page): one AI call (day-plan) orders today's todos — yours, due today or before, or marked important —
 * into time blocks around the appointments, in the free time of the working day. Only a proposal: applied, its blocks become
 * suggestions in one shadow calendar "Tagesplan <day>" (replaced when planned again). A block over an appointment, over another
 * block or outside the day never gets in. Server only.
 */
import { busyBetween, createShadowCalendar, listCalendars, replaceEvents } from "@/lib/calendar/ir";
import { dayOf, stampOf } from "@/lib/calendar/ir-shared";

export const INSTRUCTIONS = `Du planst meinen heutigen Tag: Ordne meine Todos in Zeitblöcke, um meine Termine herum, in der freien Zeit des Arbeitstags.

- Nur innerhalb des angegebenen Zeitfensters, nie über einem Termin und nie zwei Blöcke gleichzeitig.
- Das Wichtigste und Überfällige zuerst, Schwieriges eher früh, Kleinkram gebündelt; zwischen langen Blöcken etwas Luft.
- Realistische Dauer (meist 15–90 Minuten); was heute nicht mehr passt, lässt du weg.
- \`todo\`: die id des Todos (leer für einen Block ohne Todo, etwa eine Pause); \`title\`: kurz, in der Sprache des Todos; \`start\`/\`end\`: „HH:MM“.
- \`note\`: ein Satz, warum diese Reihenfolge.`;

const SCHEMA = {
  type: "object",
  properties: {
    note: { type: "string" },
    blocks: {
      type: "array",
      items: { type: "object", properties: { todo: { type: "string" }, title: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["title", "start", "end"] },
    },
  },
  required: ["blocks"],
};

/** A block of the plan: local "YYYY-MM-DDTHH:MM" times, and the todo it is for. */
export type PlanBlock = { title: string; start: string; end: string; todoId: number | null };
export type DayPlan = { day: string; blocks: PlanBlock[]; note: string };

/** The working day the plan fills. */
const WORK = { from: "08:00", to: "18:00" };

export const planCalendarName = (day: string) => `Tagesplan ${day}`;

/** The blocks that fit: inside [from, to), not ending before they start, over no busy time and no block kept before — by start. */
export function fitBlocks(blocks: PlanBlock[], busy: { start: string; end: string }[], from: string, to: string): PlanBlock[] {
  const kept: PlanBlock[] = [];
  const overlaps = (b: PlanBlock, x: { start: string; end: string }) => b.start < x.end && x.start < b.end;
  for (const b of [...blocks].sort((x, y) => x.start.localeCompare(y.start))) {
    if (!(b.start < b.end) || b.start < from || b.end > to) continue;
    if (busy.some((x) => overlaps(b, x)) || kept.some((x) => overlaps(b, x))) continue;
    kept.push(b);
  }
  return kept;
}

/** The busy appointments of a day, as local stamps (a shadow calendar blocks nothing: never the plan itself). */
const busyOf = (day: string) => busyBetween(new Date(`${day}T00:00`), new Date(`${day}T23:59`)).map((b) => ({ start: stampOf(b.start), end: stampOf(b.end), title: b.title }));

/** The next quarter hour from `now` (a plan starts no earlier). */
const nextQuarter = (now: Date) => stampOf(new Date(Math.ceil(now.getTime() / 9e5) * 9e5));

/** Today's plan, proposed by the AI (rejects without the LLM plugin or with nothing to plan). */
export async function planDay(now: Date = new Date()): Promise<DayPlan> {
  const day = dayOf(now);
  const { listTodos } = await import("@/lib/boards/store");
  const todos = listTodos({ status: "open" }).filter((x) => x.owner === "me" && !x.byWorker && ((x.due && x.due.slice(0, 10) <= day) || x.flaggedAt));
  const { t } = await import("@/lib/i18n/server");
  if (!todos.length) throw new Error(t("Nothing due today to plan."));
  const busy = busyOf(day);
  const from = [`${day}T${WORK.from}`, nextQuarter(now)].sort()[1];
  const to = `${day}T${WORK.to}`;
  const { promptText } = await import("@/lib/prompts");
  const { llm } = await import("@/plugins/llm/run");
  const prompt = [
    promptText("day-plan", INSTRUCTIONS),
    "",
    `# Zeitfenster\n${from.slice(11)}–${to.slice(11)} (${day})`,
    "",
    "# Termine",
    ...(busy.length ? busy.map((b) => JSON.stringify({ start: b.start.slice(11), end: b.end.slice(11), title: b.title })) : ["(keine)"]),
    "",
    "# Todos",
    ...todos.map((x) => JSON.stringify({ id: String(x.id), text: x.text, ...(x.due ? { due: x.due.slice(0, 10) } : {}), ...(x.flaggedAt ? { important: true } : {}), ...(x.ticket ? { ticket: x.ticket } : {}) })),
  ].join("\n");
  const answer = (await llm<{ note?: string; blocks?: { todo?: string; title?: string; start?: string; end?: string }[] }>("day-plan", prompt, SCHEMA, { timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output;
  const ids = new Map(todos.map((x) => [String(x.id), x]));
  const hhmm = /^\d{2}:\d{2}$/;
  const blocks = (answer?.blocks ?? []).flatMap((b): PlanBlock[] => {
    if (!hhmm.test(b.start ?? "") || !hhmm.test(b.end ?? "")) return [];
    const todo = ids.get(String(b.todo ?? ""));
    const title = (b.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || todo?.text || "";
    return title ? [{ title, start: `${day}T${b.start}`, end: `${day}T${b.end}`, todoId: todo?.id ?? null }] : [];
  });
  return { day, blocks: fitBlocks(blocks, busy, from, to), note: (answer?.note ?? "").trim().slice(0, 500) };
}

/** A plan applied: its blocks (those that fit the day as it is now) the suggestions of the day's "Tagesplan" calendar — what was there before replaced. */
export function applyDayPlan(day: string, blocks: PlanBlock[]): { calendarId: number; count: number } {
  const name = planCalendarName(day);
  const calendar = listCalendars().find((c) => c.shadow && c.name === name) ?? createShadowCalendar(name);
  const fit = fitBlocks(blocks, busyOf(day), `${day}T00:00`, `${day}T23:59`);
  replaceEvents(
    calendar.id,
    fit.map((b, i) => ({ key: `plan:${i}`, title: b.title, start: b.start, end: b.end, todoId: b.todoId })),
  );
  return { calendarId: calendar.id, count: fit.length };
}
