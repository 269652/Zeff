import type { SessionItem, SessionTicket } from "@/lib/work/sessions";

/**
 * How the session list is sorted and grouped (the sidebar of the Work tab, like Claude Code's):
 *   newest    by time, under the headings Today / Yesterday / Previous 7 days / Earlier
 *   priority  what needs you first, then what is working, what failed, the rest — newest first in each
 *   ticket    under their ticket, the tickets in key order, newest first inside
 *   alpha     by title, no headings
 * Pure (client-safe): `now` is null while the page isn't mounted yet — no time-dependent headings then
 * (the server and the browser may not agree on what "today" is).
 */
export const SORTS = ["newest", "priority", "ticket", "alpha"] as const;
export type SortKey = (typeof SORTS)[number];
export const isSort = (v: unknown): v is SortKey => (SORTS as readonly unknown[]).includes(v);

export type Row = SessionItem & { ticket: string; summary: string | null };
/** `id` names the heading (the sidebar translates it); a ticket's group carries the ticket. */
export type Group = { key: string; id: "all" | "today" | "yesterday" | "week" | "older" | "waiting" | "working" | "attention" | "other" | "ticket"; ticket?: string; summary?: string | null; rows: Row[] };

/** SQLite's "2026-10-14 12:00:00" (UTC) or an ISO stamp: milliseconds. */
export const stamp = (iso: string) => (iso ? Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) || 0 : 0);

/** 0 needs you · 1 working · 2 failed or cut off · 3 the rest. */
export const priorityOf = (s: Pick<SessionItem, "waiting" | "live" | "status">): 0 | 1 | 2 | 3 =>
  s.waiting ? 0 : s.status === "running" || s.status === "queued" || s.live ? 1 : s.status === "failed" || s.status === "interrupted" ? 2 : 3;

const newest = (a: Row, b: Row) => stamp(b.at) - stamp(a.at) || b.id - a.id;

export function groupSessions(tickets: SessionTicket[], sort: SortKey, now: number | null): Group[] {
  const rows: Row[] = tickets.flatMap((t) => t.sessions.map((s) => ({ ...s, ticket: t.ticket, summary: t.summary })));
  const by = (id: Group["id"], list: Row[], extra: Partial<Group> = {}): Group[] => (list.length ? [{ key: extra.ticket ?? id, id, rows: list, ...extra }] : []);

  if (sort === "alpha") return by("all", [...rows].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) || newest(a, b)));

  if (sort === "priority") {
    const sorted = [...rows].sort((a, b) => priorityOf(a) - priorityOf(b) || newest(a, b));
    const ids = ["waiting", "working", "attention", "other"] as const;
    return ids.flatMap((id, i) => by(id, sorted.filter((r) => priorityOf(r) === i)));
  }

  if (sort === "ticket") {
    const sorted = [...rows].sort(newest);
    const keys = [...new Set(sorted.map((r) => r.ticket))].sort((a, b) => Number(!a) - Number(!b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    return keys.flatMap((k) => {
      const mine = sorted.filter((r) => r.ticket === k);
      return by("ticket", mine, { ticket: k, summary: mine[0]?.summary ?? null, key: `ticket:${k}` });
    });
  }

  // newest
  const sorted = [...rows].sort(newest);
  if (now === null) return by("all", sorted);
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const today = day.getTime();
  const DAY = 864e5;
  const bucket = (r: Row): Group["id"] => {
    const t = stamp(r.at);
    return t >= today ? "today" : t >= today - DAY ? "yesterday" : t >= today - 7 * DAY ? "week" : "older";
  };
  return (["today", "yesterday", "week", "older"] as const).flatMap((id) => by(id, sorted.filter((r) => bucket(r) === id)));
}
