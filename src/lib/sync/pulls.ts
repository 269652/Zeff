import path from "node:path";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import type { ChronoPulledEntry } from "@/lib/chrono-status";
import type { PunchRecord } from "@/lib/punch-status";

/**
 * One call to one of Zeff's automation-Chrome drivers (scripts/<name>-mcp.mjs, no LLM), its
 * answer as text. The pulls here only read (Chrono, Punch, Outlook): nothing changes there.
 */
export async function callDriver(name: "chrono" | "punch" | "outlook", tool: string, args: Record<string, unknown>, label: string, timeoutMs: number): Promise<string> {
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", `${name}-mcp.mjs`);
  const out = await runStdioSession({ command: process.execPath, args: [script], env: {}, label }, async (call) => resultToPayload(await call(tool, args)), timeoutMs);
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** Store a week's pulled Chrono entries; how many there are per status. */
export async function keepChronoPull(weekStartIso: string, entries: ChronoPulledEntry[]): Promise<Map<string, number>> {
  const { saveChronoPull, chronoStatusKind } = await import("@/lib/chrono-status");
  saveChronoPull(weekStartIso, entries);
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(chronoStatusKind(e.status), (counts.get(chronoStatusKind(e.status)) ?? 0) + 1);
  return counts;
}

/** "6 approved, 4 submitted" in a fixed order. */
export function statusCounts(counts: Map<string, number>): string {
  return ["approved", "submitted", "rejected", "draft"].filter((k) => counts.get(k)).map((k) => `${counts.get(k)} ${k}`).join(", ");
}

/** Pull these weeks (Monday ISO dates, those begun) from Chrono in one visit and keep them. */
export async function pullChronoWeekStarts(weekStartIsos: string[]): Promise<{ ok: boolean; message: string }> {
  const { todayIso } = await import("@/lib/week");
  const weeks = [...new Set(weekStartIsos)].filter((w) => w <= todayIso()).sort();
  if (weeks.length === 0) return { ok: true, message: "These weeks haven't begun yet." };
  const raw = await callDriver("chrono", "chrono_pull", { weekStartIsos: weeks }, "Chrono pull", 180000);
  let pulled: { weekStartIso: string; entries: ChronoPulledEntry[] }[];
  try {
    pulled = (JSON.parse(raw) as { weeks?: typeof pulled }).weeks ?? [];
  } catch {
    return { ok: false, message: raw.slice(0, 300) };
  }
  const counts = new Map<string, number>();
  for (const w of pulled) {
    for (const [k, n] of await keepChronoPull(w.weekStartIso, w.entries)) counts.set(k, (counts.get(k) ?? 0) + n);
  }
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  const w = `${pulled.length} week${pulled.length === 1 ? "" : "s"}`;
  return { ok: true, message: n ? `Pulled ${n} Chrono entries in ${w}: ${statusCounts(counts)}.` : `Chrono has no entries in these ${w}.` };
}

/** Read what Punch has on these days (read-only) and keep it for the weekly Punch marks. */
export async function pullPunchIsoDays(isoDays: string[]): Promise<void> {
  const raw = await callDriver("punch", "punch_days", { isoDays }, "Punch pull", 240000);
  let days: Record<string, PunchRecord>;
  try {
    days = (JSON.parse(raw) as { days?: typeof days }).days ?? {};
  } catch {
    throw new Error(raw.slice(0, 300));
  }
  const { savePunchDays } = await import("@/lib/punch-status");
  savePunchDays(days);
}

/**
 * Read the calendar from Outlook (read-only) for these weeks into the meeting inbox, each week
 * replacing what was there. How many weeks and events.
 */
export async function syncOutlookWeekStarts(weekStartIsos: string[]): Promise<{ weeks: number; events: number }> {
  const raw = await callDriver("outlook", "outlook_events", { weekStartIsos: [...new Set(weekStartIsos)].sort() }, "Outlook sync", 300000);
  let pulled: { weekStartIso: string; events: unknown[] }[];
  try {
    pulled = (JSON.parse(raw) as { weeks?: typeof pulled }).weeks ?? [];
  } catch {
    throw new Error(raw.slice(0, 300));
  }
  const { replaceInboxWeeks } = await import("@/lib/calendar/inbox");
  const r = replaceInboxWeeks(pulled);
  return { weeks: pulled.length, events: r.events };
}

/** The weeks a calendar sync reads: from the start of last month to the end of next week (and one shown). */
export async function outlookWeeks(shownWeekStartIso?: string): Promise<string[]> {
  const { currentWeek, shiftWeek, weekFromDate } = await import("@/lib/week");
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const end = shiftWeek(currentWeek(), 1).startIso;
  const weeks = new Set<string>(shownWeekStartIso ? [shownWeekStartIso] : []);
  for (let w = weekFromDate(lastAndCurrentMonth().last.start); w.startIso <= end; w = shiftWeek(w, 1)) weeks.add(w.startIso);
  return [...weeks].sort();
}
