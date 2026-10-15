import { automationEnv, driverPath, type DriverId } from "@/plugins/drivers";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";

/**
 * One call to one of Zeff's automation-Chrome drivers (scripts/<name>-mcp.mjs, no LLM), its
 * answer as text. The pulls only read: nothing changes there (Outlook's here; the booking systems' in their integration).
 */
export async function callDriver(name: DriverId, tool: string, args: Record<string, unknown>, label: string, timeoutMs: number): Promise<string> {
  const script = driverPath(name);
  const out = await runStdioSession({ command: process.execPath, args: [script], env: automationEnv(), label }, async (call) => resultToPayload(await call(tool, args)), timeoutMs);
  return typeof out === "string" ? out : JSON.stringify(out);
}

/**
 * Read the calendar from Outlook (read-only) for these weeks into the meeting inbox, each week
 * replacing what was there. How many weeks and events.
 */
export async function syncOutlookWeekStarts(weekStartIsos: string[]): Promise<{ weeks: number; events: number }> {
  const weeks = [...new Set(weekStartIsos)].sort();
  let pulled: { weekStartIso: string; events: unknown[] }[];
  if ((await import("@/lib/connectors/store")).driverOf("outlook-calendar") === "api") {
    // Through Microsoft Graph: no Chrome.
    pulled = await (await import("@/lib/microsoft/calendar-api")).readWeeks(weeks);
  } else {
    const raw = await callDriver("outlook", "outlook_events", { weekStartIsos: weeks }, "Outlook sync", 300000);
    try {
      pulled = (JSON.parse(raw) as { weeks?: typeof pulled }).weeks ?? [];
    } catch {
      throw new Error(raw.slice(0, 300));
    }
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
