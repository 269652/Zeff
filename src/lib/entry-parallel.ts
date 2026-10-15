import { listEntries, requireEntry, type EntryWithJob } from "./entries";
import { createSpan, entryRow, linkMember, membersOf, recomputeSpan, setSpanMode, spansOn, workedOf, type EntrySpan, type SpanMode } from "./entry-spans";
import { endOf, normalizeStart, parallelClusters, stretchOf, type Cluster } from "./entry-timeline";
import { ValidationError } from "./errors";
import { listPausesByDate } from "./pauses";
import { toMinutes } from "./pauses-shared";
import { getPref, setPref } from "./prefs";
import { t } from "@/lib/i18n/server";

/**
 * Parallel work: tasks of one job (or project) done at the same time, or under a collecting entry
 * (a mob day). Detected from the tasks' start and hours and kept as a span (entry-spans.ts): every
 * task stays an entry with its real hours and start; only how the span is BOOKED varies — combined
 * (one spanning entry), divided, one after the other, or collected under an entry of yours. New work is
 * grouped by default the way set (parallel:mode); a collecting entry takes what runs parallel to it.
 */

export type ParallelMode = "combine" | "divide" | "sequential";
export const PARALLEL_MODES: ParallelMode[] = ["combine", "divide", "sequential"];
const PREF = "parallel:mode";

export const defaultParallelMode = (): ParallelMode => {
  const v = getPref<string>(PREF, "divide");
  return (PARALLEL_MODES as string[]).includes(v) ? (v as ParallelMode) : "divide";
};
export const setDefaultParallelMode = (m: ParallelMode) => setPref(PREF, PARALLEL_MODES.includes(m) ? m : "divide");

const breaksOf = (date: string) => listPausesByDate(date, date)[date] ?? [];
const keyOf = (e: { date: string; projectId: number | null; jobId: number }) => `${e.date}|${e.projectId !== null ? `p${e.projectId}` : `j${e.jobId}`}`;

/* ───────────── a collecting entry's window (a mob day) ───────────── */

type Window = { from: number; to: number } | null;

/** The window of a collecting entry: its start to its end (its hours, the day's breaks left out); null without a start (the whole day). */
export function headWindow(head: { date: string; hours: number; start: string | null }): Window {
  const s = normalizeStart(head.start);
  if (!s) return null;
  const from = toMinutes(s);
  return { from, to: endOf(from, Math.round(head.hours * 60), breaksOf(head.date)) };
}

/** Whether work with this start and hours overlaps the window — or has no start (a day's collecting entry takes it). */
export function isParallel(window: Window, probe: { start?: string | null; hours?: number; date: string }): boolean {
  if (!window) return true;
  const s = normalizeStart(probe.start);
  if (!s) return true;
  const from = toMinutes(s);
  return from < window.to && endOf(from, Math.round((probe.hours ?? 0) * 60), breaksOf(probe.date)) > window.from;
}

export type GroupOption = {
  spanId: string;
  /** A collecting entry's words, or the stretch parallel work spans. */
  label: string;
  /** collecting: an entry of yours (a mob day) · parallel: tasks done at the same time. */
  kind: "collect" | "parallel";
  /** How it books now: combine · collect · divide · sequential · remainder. */
  mode: string;
  /** Its own entry (a collecting or combined one), if any. */
  headId: number | null;
  /** The head is yours (not made by Zeff). */
  headOwn: boolean;
};

/** Every group of a day — collecting entries (there can be several) and groups of parallel work — for the group menu of an entry. */
export function groupOptionsOn(date: string): GroupOption[] {
  const breaks = breaksOf(date);
  return spansOn(date)
    .map((span): GroupOption => {
      const head = span.headId ? entryRow(span.headId) : undefined;
      const members = membersOf(span.id);
      const s = stretchOf(members.map((m) => ({ start: m.start, hours: workedOf(m) })), breaks);
      const own = !!head && !span.headAuto;
      return {
        spanId: span.id,
        label: head ? head.description : t("Parallel work {from}–{to}", { from: s.from ?? "?", to: s.to ?? "?" }),
        kind: own ? "collect" : "parallel",
        mode: span.mode,
        headId: head?.id ?? null,
        headOwn: own,
      };
    })
    .sort((a, b) => Number(b.kind === "collect") - Number(a.kind === "collect") || a.spanId.localeCompare(b.spanId));
}

/** The collecting entries of a day (a mob day's), with their spans. */
export function collectHeadsOn(date: string): { span: EntrySpan; head: { id: number; description: string; hours: number; start: string | null; date: string } }[] {
  const out: { span: EntrySpan; head: { id: number; description: string; hours: number; start: string | null; date: string } }[] = [];
  for (const span of spansOn(date)) {
    if (span.mode !== "collect" || !span.headId) continue;
    const h = entryRow(span.headId);
    if (h) out.push({ span, head: { id: h.id, description: h.description, hours: h.workedHours ?? h.hours, start: h.start, date: h.date } });
  }
  return out.sort((a, b) => a.head.id - b.head.id);
}

/** The collecting entry work with this start and hours belongs to by default — none when it lies outside every window. */
export function collectSpanFor(date: string, probe: { start?: string | null; hours?: number } = {}) {
  return collectHeadsOn(date).find((c) => isParallel(headWindow(c.head), { ...probe, date }));
}

/** The day's other entries that run parallel to a collecting entry and are not grouped yet. */
export function collectCandidates(headId: number): EntryWithJob[] {
  const h = requireEntry(headId);
  const c = collectHeadsOn(h.date).find((x) => x.head.id === headId);
  if (!c) return [];
  const w = headWindow(c.head);
  return listEntries({ from: h.date, to: h.date }).filter((e) => e.id !== h.id && !e.isGroup && !e.spanId && isParallel(w, { start: e.start, hours: workedOf(e), date: e.date }));
}

/** Everything that runs parallel to a collecting entry is grouped under it — nothing is moved or rewritten, the hours are booked by it. Returns how many. */
export function collectIntoHead(headId: number): number {
  const c = collectHeadsOn(requireEntry(headId).date).find((x) => x.head.id === headId);
  if (!c) throw new ValidationError(t("This entry is not a group entry."));
  const list = collectCandidates(headId);
  for (const e of list) linkMember(e.id, c.span.id, { recompute: false });
  if (list.length) recomputeSpan(c.span.id);
  return list.length;
}

/* ───────────── detection and booking of parallel work ───────────── */

export type ParallelSet = Cluster & { date: string; label: string; entries: EntryWithJob[] };

/** Parallel work in a period that is not grouped yet: overlapping tasks of one job or project, not in a span. */
export function detectParallel(from: string, to: string): ParallelSet[] {
  const entries = listEntries({ from, to }).filter((e) => !e.isGroup && !e.spanId && normalizeStart(e.start));
  const out: ParallelSet[] = [];
  for (const date of new Set(entries.map((e) => e.date))) {
    const heads = collectHeadsOn(date);
    // What runs parallel to a collecting entry belongs to it: it is collected, not combined.
    const claimed = (e: EntryWithJob) => heads.some((c) => isParallel(headWindow(c.head), { start: e.start, hours: e.hours, date }));
    const day = entries.filter((e) => e.date === date && !claimed(e));
    for (const c of parallelClusters(day.map((e) => ({ id: e.id, start: e.start, hours: e.hours, key: keyOf(e) })), breaksOf(date))) {
      const list = c.ids.map((id) => day.find((e) => e.id === id)!);
      out.push({ ...c, date, label: list[0].project?.title ?? list[0].job.name, entries: list });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from));
}

/** Tasks grouped as one span, booked the way chosen. Nothing about the tasks changes but what they book. */
export function applyParallel(ids: number[], mode: ParallelMode): { mode: ParallelMode; spanId: string; ids: number[] } {
  const entries = [...new Set(ids)].map(requireEntry);
  if (entries.length < 2) throw new ValidationError(t("Parallel work needs at least two entries."));
  if (entries.some((e) => e.isGroup)) throw new ValidationError(t("A group entry can't be part of parallel work."));
  if (new Set(entries.map((e) => e.date)).size > 1) throw new ValidationError(t("Parallel work happens on one day."));
  if (entries.some((e) => e.spanId)) throw new ValidationError(t("Some of these are grouped already."));
  const span = createSpan(entries[0].date, mode);
  for (const e of entries) linkMember(e.id, span.id, { recompute: false });
  recomputeSpan(span.id);
  return { mode, spanId: span.id, ids: entries.map((e) => e.id) };
}

/** The mode of a span of tasks changed (combined · divided · one after the other). */
export const setParallelMode = (spanId: string, mode: ParallelMode): EntrySpan => setSpanMode(spanId, mode as SpanMode);

/**
 * An entry just booked, with its start and hours: if it runs in parallel — to a collecting entry
 * (it goes under it), or to other work of its job or project that day (it joins their span, or makes
 * a new one with them, booked the way set) — it is grouped. Null: nothing parallel, or no start to
 * tell by (a collecting entry takes entries without a start, too).
 */
export function autoGroup(entryId: number, mode: ParallelMode = defaultParallelMode()): { mode: SpanMode; spanId: string; ids: number[] } | null {
  const e = requireEntry(entryId);
  if (e.isGroup || e.spanId) return null;
  const worked = workedOf(e);
  const collecting = collectSpanFor(e.date, { start: e.start, hours: worked });
  if (collecting) {
    linkMember(e.id, collecting.span.id);
    return { mode: "collect", spanId: collecting.span.id, ids: [e.id] };
  }
  if (!normalizeStart(e.start)) return null;
  const breaks = breaksOf(e.date);
  const interval = (start: string, hours: number) => {
    const f = toMinutes(normalizeStart(start)!);
    return { f, to: endOf(f, Math.round(hours * 60), breaks) };
  };
  const mine = interval(e.start!, worked);
  // A span of the same job or project this runs into: it joins it (the span is booked again).
  for (const span of spansOn(e.date)) {
    if (span.mode === "collect") continue;
    const members = membersOf(span.id);
    if (!members.length || keyOf(members[0]) !== keyOf(e)) continue;
    const s = stretchOf(members.map((m) => ({ start: m.start, hours: workedOf(m) })), breaks);
    if (!s.from || !s.to) continue;
    const f = toMinutes(s.from);
    const to = toMinutes(s.to);
    if (mine.f < to && f < mine.to) {
      linkMember(e.id, span.id);
      return { mode: span.mode as SpanMode, spanId: span.id, ids: [...members.map((m) => m.id), e.id] };
    }
  }
  const plain = listEntries({ from: e.date, to: e.date }).filter((x) => x.id !== e.id && !x.isGroup && !x.spanId && keyOf(x) === keyOf(e) && normalizeStart(x.start));
  const c = parallelClusters([e, ...plain].map((x) => ({ id: x.id, start: x.start, hours: x.hours, key: "k" })), breaks).find((cl) => cl.ids.includes(e.id));
  return c ? applyParallel(c.ids, mode) : null;
}

/** A line saying what was done with parallel work (for a booking's answer). */
export function parallelSaid(r: { mode: SpanMode; ids: number[] }): string {
  const n = Math.max(1, r.ids.length - 1);
  if (r.mode === "collect") return t("Runs parallel to the day's group entry — grouped under it.");
  return r.mode === "combine"
    ? t("Runs parallel to {n} other entries — combined into one spanning entry.", { n })
    : r.mode === "divide"
      ? t("Runs parallel to {n} other entries — the stretch's hours are divided between them.", { n })
      : t("Runs parallel to {n} other entries — booked one after the other.", { n });
}

