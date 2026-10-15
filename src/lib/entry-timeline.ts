/**
 * The items under a group entry (a mob day) laid out in time: each has a start and its hours; its
 * end is the start plus the hours, with the day's breaks left out (a stretch that runs through a
 * break ends later). Items that overlap are either sequential (their hours add up) or parallel
 * (together they take from the earlier start to the later end, minus the breaks). Server-free: the
 * item editor previews the same numbers the server saves. Tests: tests/entry-timeline.test.ts.
 */
import { fromMinutes, toMinutes, type PauseRange } from "./pauses-shared";

export type TimedItem = {
  id: number;
  /** "HH:MM", or null when it isn't known when the work was done. */
  start: string | null;
  hours: number;
  /** When it overlaps an earlier item: done at the same time as it (else after it). */
  parallel: boolean;
};

export type PlacedItem = {
  id: number;
  /** Where it ends (own start + hours + breaks in between), "HH:MM"; null without a start. */
  end: string | null;
  /** The part of it that overlaps the item(s) before — the choice parallel / sequential is about it. */
  overlapsPrevious: boolean;
  /** Where it counts from, if different from its own start (sequential after an overlapping item), "HH:MM". */
  shiftedStart: string | null;
};

export type Block = { from: string; to: string; workHours: number; ids: number[] };

export type Layout = {
  items: PlacedItem[];
  /** Stretches of work: items that run into each other (in parallel or one after the other) form one. */
  blocks: Block[];
  /** The hours the items add up to: the blocks' work (breaks left out) plus the items without a start. */
  itemizedHours: number;
  /** Items without a start (their hours count one after the other). */
  unplaced: number[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Minutes of `[a, b)` that fall into breaks. */
export function breakMinutesIn(a: number, b: number, breaks: PauseRange[]): number {
  let sum = 0;
  for (const p of breaks) sum += Math.max(0, Math.min(b, toMinutes(p.end)) - Math.max(a, toMinutes(p.start)));
  return sum;
}

/** The end of `workMinutes` of work begun at `start` (minutes of the day): breaks in the way are skipped. */
export function endOf(start: number, workMinutes: number, breaks: PauseRange[]): number {
  const sorted = breaks.map((p) => ({ from: toMinutes(p.start), to: toMinutes(p.end) })).filter((p) => p.to > p.from).sort((a, b) => a.from - b.from);
  let t = start;
  let left = Math.round(workMinutes);
  for (const p of sorted) {
    if (p.to <= t) continue;
    if (p.from > t) {
      const free = p.from - t;
      if (left <= free) return t + left;
      left -= free;
    }
    t = Math.max(t, p.to);
  }
  return t + left;
}

/** Work minutes in `[a, b)`: its length without the breaks in it. */
export const workMinutesBetween = (a: number, b: number, breaks: PauseRange[]) => Math.max(0, b - a - breakMinutesIn(a, b, breaks));

/** A time of the day the item editor typed: "HH:MM" (also "9", "9.30", "930"); undefined when it isn't one. */
export function normalizeStart(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s) ?? /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h <= 23 && min <= 59 ? fromMinutes(h * 60 + min) : null;
}

export function layoutItems(items: TimedItem[], breaks: PauseRange[]): Layout {
  const placed = new Map<number, PlacedItem>();
  const unplaced: number[] = [];
  const timed = items.filter((i) => normalizeStart(i.start) !== null).map((i) => ({ ...i, s: toMinutes(normalizeStart(i.start)!), work: Math.round(i.hours * 60) }));
  timed.sort((a, b) => a.s - b.s || a.id - b.id);
  for (const i of items) if (normalizeStart(i.start) === null) unplaced.push(i.id);

  type Open = { from: number; to: number; ids: number[] };
  const blocks: Open[] = [];
  let cur: Open | null = null;
  for (const it of timed) {
    const ownEnd = endOf(it.s, it.work, breaks);
    if (cur && it.s < cur.to) {
      // It runs into the stretch before it: together (parallel) or after it (sequential).
      if (it.parallel) {
        cur.to = Math.max(cur.to, ownEnd);
        placed.set(it.id, { id: it.id, end: fromMinutes(ownEnd), overlapsPrevious: true, shiftedStart: null });
      } else {
        const from = cur.to;
        const end = endOf(from, it.work, breaks);
        cur.to = end;
        placed.set(it.id, { id: it.id, end: fromMinutes(end), overlapsPrevious: true, shiftedStart: fromMinutes(from) });
      }
      cur.ids.push(it.id);
    } else {
      cur = { from: it.s, to: ownEnd, ids: [it.id] };
      blocks.push(cur);
      placed.set(it.id, { id: it.id, end: fromMinutes(ownEnd), overlapsPrevious: false, shiftedStart: null });
    }
  }
  const out: Block[] = blocks.map((b) => ({ from: fromMinutes(b.from), to: fromMinutes(b.to), workHours: round2(workMinutesBetween(b.from, b.to, breaks) / 60), ids: b.ids }));
  const unplacedHours = items.filter((i) => unplaced.includes(i.id)).reduce((s, i) => s + i.hours, 0);
  for (const id of unplaced) placed.set(id, { id, end: null, overlapsPrevious: false, shiftedStart: null });
  return {
    items: items.map((i) => placed.get(i.id)!),
    blocks: out,
    itemizedHours: round2(out.reduce((s, b) => s + b.workHours, 0) + unplacedHours),
    unplaced,
  };
}

/* ───────────── parallel work: entries that overlap in time ───────────── */

export type SpanEntry = { id: number; start: string | null; hours: number; /** Entries only run in parallel within one key (a job or project of a day). */ key: string };

export type Cluster = {
  key: string;
  ids: number[];
  /** The stretch they span ("HH:MM"). */
  from: string;
  to: string;
  /** What that stretch is worth in work hours (the breaks left out). */
  spanHours: number;
  /** What the entries were booked with, added up. */
  sumHours: number;
};

/** Entries that overlap in time (transitively), within one key — two or more make a cluster. Entries without a start are never in one. */
export function parallelClusters(entries: SpanEntry[], breaks: PauseRange[]): Cluster[] {
  const out: Cluster[] = [];
  const byKey = new Map<string, SpanEntry[]>();
  for (const e of entries) if (normalizeStart(e.start) !== null) (byKey.get(e.key) ?? byKey.set(e.key, []).get(e.key)!).push(e);
  for (const [key, list] of byKey) {
    const timed = list.map((e) => ({ e, s: toMinutes(normalizeStart(e.start)!) })).sort((a, b) => a.s - b.s || a.e.id - b.e.id);
    let cur: { from: number; to: number; ids: number[]; sum: number } | null = null;
    const close = () => {
      if (cur && cur.ids.length >= 2)
        out.push({ key, ids: cur.ids, from: fromMinutes(cur.from), to: fromMinutes(cur.to), spanHours: round2(workMinutesBetween(cur.from, cur.to, breaks) / 60), sumHours: round2(cur.sum) });
    };
    for (const { e, s } of timed) {
      const end = endOf(s, Math.round(e.hours * 60), breaks);
      if (cur && s < cur.to) {
        cur.to = Math.max(cur.to, end);
        cur.ids.push(e.id);
        cur.sum += e.hours;
      } else {
        close();
        cur = { from: s, to: end, ids: [e.id], sum: e.hours };
      }
    }
    close();
  }
  return out;
}

/**
 * `total` hours divided over the parts in proportion to what each worked (3 h + 3 h over 3 h →
 * 1.5 + 1.5), to two decimals; the last takes what rounding leaves, so the shares add up to `total`.
 */
export function divideHours(total: number, parts: { id: number; hours: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const sum = parts.reduce((s, p) => s + Math.max(0, p.hours), 0);
  let left = round2(total);
  parts.forEach((p, i) => {
    const share = i === parts.length - 1 ? left : round2(sum > 0 ? (total * Math.max(0, p.hours)) / sum : total / parts.length);
    const v = Math.max(0.01, round2(Math.min(share, left)));
    out.set(p.id, v);
    left = round2(left - v);
  });
  return out;
}

/**
 * Parallel work booked one after the other: each entry starts where the one before ends (the
 * breaks left out), so nothing overlaps any more and every entry keeps its full hours. The first
 * keeps its start. Returns the new start of each entry that moved.
 */
export function sequentialStarts(entries: { id: number; start: string; hours: number }[], breaks: PauseRange[]): Map<number, string> {
  const moved = new Map<number, string>();
  const sorted = [...entries].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.id - b.id);
  let end = -1;
  for (const e of sorted) {
    let s = toMinutes(e.start);
    if (end >= 0 && s < end) {
      s = end;
      moved.set(e.id, fromMinutes(s));
    }
    end = endOf(s, Math.round(e.hours * 60), breaks);
  }
  return moved;
}

/** The one line of a combined entry: the tickets, then what was done ("PROJ-1, PROJ-2: Login · Header"). */
export function combineDescription(parts: { ticket: string | null; description: string }[], max = 180): string {
  const tickets = [...new Set(parts.map((p) => (p.ticket ?? "").trim().toUpperCase()).filter(Boolean))];
  const words = [...new Set(parts.map((p) => p.description.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const text = tickets.length ? `${tickets.join(", ")}: ${words.join(" · ")}` : words.join(" · ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The stretch some tasks span: from the earliest start to the latest end (the breaks left out), in
 * hours — when every task has a start; else (nothing to tell by) what they add up to.
 */
export function stretchOf(entries: { start: string | null; hours: number }[], breaks: PauseRange[]): { from: string | null; to: string | null; hours: number } {
  const timed = entries.filter((e) => normalizeStart(e.start) !== null);
  const sum = round2(entries.reduce((s, e) => s + e.hours, 0));
  if (!timed.length) return { from: null, to: null, hours: sum };
  const from = Math.min(...timed.map((e) => toMinutes(normalizeStart(e.start)!)));
  if (timed.length !== entries.length) return { from: fromMinutes(from), to: null, hours: sum };
  const to = Math.max(...timed.map((e) => endOf(toMinutes(normalizeStart(e.start)!), Math.round(e.hours * 60), breaks)));
  return { from: fromMinutes(from), to: fromMinutes(to), hours: Math.max(0.25, round2(workMinutesBetween(from, to, breaks) / 60)) };
}
