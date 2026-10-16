import type { Row } from "@/plugins/workspace/model";

/**
 * The inbox's list by conversation: one entry per thread — its latest message, how many messages, how many unread — and snooze:
 * a thread whose messages are all snoozed is away until the time (a new, unsnoozed message brings it back).
 */
export type Thread = { head: Row; count: number; unread: number; ids: number[] };

const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) || 0 : 0);

export function groupThreads(rows: Row[], now = Date.now()): { threads: Thread[]; snoozed: number } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const conv = String(r.cells.commconv ?? "");
    const key = conv ? `c:${conv}` : `r:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const threads: Thread[] = [];
  let snoozed = 0;
  for (const list of groups.values()) {
    const away = (r: Row) => time(r.cells.commsnooze) > now;
    if (list.every(away)) {
      snoozed++;
      continue;
    }
    const sorted = [...list].sort((a, b) => time(b.cells.commwhen) - time(a.cells.commwhen));
    threads.push({ head: sorted[0], count: list.length, unread: list.filter((r) => r.cells.communread).length, ids: list.map((r) => r.id) });
  }
  threads.sort((a, b) => time(b.head.cells.commwhen) - time(a.head.cells.commwhen));
  return { threads, snoozed };
}

export type SnoozeOption = "later" | "tomorrow" | "week";

/** When a snooze ends (ISO): later today (3 hours, at the earliest 13:00), tomorrow 8:00, next Monday 8:00. */
export function snoozeUntil(option: SnoozeOption, now = new Date()): string {
  const d = new Date(now);
  if (option === "later") {
    d.setHours(Math.max(13, now.getHours() + 3), 0, 0, 0);
  } else if (option === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(8, 0, 0, 0);
  }
  return d.toISOString();
}
