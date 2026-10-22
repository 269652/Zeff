import type { T } from "@/lib/i18n/shared";

/**
 * How healthy each source is — judged from its data, not only from whether its last run said ok (client-safe, pure).
 *
 * The worst failure of a browser driver is a silent one: the site changed a little, the step still says ok, but it brings
 * nothing (or far less) — for days, and everything built on it (the briefing, knowledge, people, the timeline) quietly
 * thins out. So a step is judged by:
 * - failing: its runs keep failing (twice in a row, or one failure standing for 12 hours);
 * - drift: the app no longer matches what its driver expects (WhatsApp's and Signal's contract, as their last check said);
 * - stale: it runs by itself, but no run came for clearly longer than its interval (the quiet hours, a workday step's
 *   weekend and the time the Zeff server wasn't running don't count);
 * - silent: its runs go through, but nothing new arrived for clearly longer than its own history says is normal — or far
 *   fewer items a day than usual.
 *
 * Time is measured in ACTIVE minutes: the quiet hours (19–08, when nothing syncs) never count, and for a source whose
 * history is quiet at the weekend (work: Teams, Jira, Outlook …) neither do weekends and your days off — so Monday morning
 * after a quiet weekend is no alarm.
 */

export type HealthState = "ok" | "stale" | "silent" | "failing" | "drift";

/** The quiet hours as the scheduler keeps them (src/lib/sync/registry.ts QUIET) — passed in by the server, this the default. */
export const DEFAULT_QUIET = { from: 19, to: 8 };

/** When time counts: outside the quiet hours (none: always), at weekends or not, minus days off (local "YYYY-MM-DD"). */
export type Activity = { quiet: { from: number; to: number } | null; weekends: boolean; skipDays?: ReadonlySet<string> };

/** Failing this many runs in a row, or for this long, is a problem — once is a blip. */
export const FAIL_RUNS = 2;
export const FAIL_HOURS = 12;

const DAY = 86400e3;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const dayOff = (d: Date, a: Activity) => (!a.weekends && isWeekend(d)) || !!a.skipDays?.has(isoDate(d));

/** The minutes between two times that count (local days, their window outside the quiet hours). */
export function activeMinutes(from: number, to: number, a: Activity): number {
  if (!(to > from)) return 0;
  let ms = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) {
    if (dayOff(d, a)) continue;
    const start = new Date(d);
    const end = new Date(d);
    if (a.quiet) {
      start.setHours(a.quiet.to, 0, 0, 0);
      end.setHours(a.quiet.from, 0, 0, 0);
    } else end.setDate(end.getDate() + 1);
    const lo = Math.max(from, start.getTime());
    const hi = Math.min(to, end.getTime());
    if (hi > lo) ms += hi - lo;
  }
  return ms / 60000;
}

/** Arrivals within a few minutes are one; the active minutes between consecutive arrivals (sorted, zero gaps left out). */
export function arrivalGaps(times: number[], a: Activity, mergeMinutes = 5): number[] {
  return gapsWithEnds(times, a, mergeMinutes).map((g) => g.min);
}

function merged(times: number[], mergeMinutes = 5): number[] {
  const out: number[] = [];
  for (const x of [...times].sort((p, q) => p - q)) if (!out.length || x - out[out.length - 1] > mergeMinutes * 60000) out.push(x);
  return out;
}

function gapsWithEnds(times: number[], a: Activity, mergeMinutes = 5): { min: number; end: number }[] {
  const m = merged(times, mergeMinutes);
  const out: { min: number; end: number }[] = [];
  for (let i = 1; i < m.length; i++) {
    const min = activeMinutes(m[i - 1], m[i], a);
    if (min > 0) out.push({ min, end: m[i] });
  }
  return out;
}

/** Nearest-rank quantile of sorted numbers. */
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
const sortNum = (xs: number[]) => [...xs].sort((p, q) => p - q);

/** A source's history is quiet at the weekend: enough of it, and (almost) nothing came on a Saturday or Sunday. */
export function weekendsQuiet(times: number[]): boolean {
  if (times.length < 20) return false;
  const span = Math.max(...times) - Math.min(...times);
  if (span < 14 * DAY) return false;
  const weekend = times.filter((x) => isWeekend(new Date(x))).length;
  return weekend / times.length < 0.05;
}

/** What is usual for a source: the median gap between arrivals and the longest gap of a usual day — and the silence that is not. */
export type Baseline = { samples: number; medianMin: number; usualLongestMin: number; thresholdMin: number };

/** At least this many gaps (over at least this many days) before a source is ever called silent. */
const MIN_GAPS = 8;
const MIN_DAYS = 5;

/**
 * The silence that is clearly unusual: 1.5 × the longest gap of a usual day (the 90th percentile of each day's longest gap
 * — overnight, a quiet afternoon), at least 6 × the median gap and at least `floorMin`. Null with too little history.
 * The days are the gaps' end days (`ends`); without them each gap is its own day.
 */
export function baselineOf(gaps: number[], floorMin: number, ends?: number[]): Baseline | null {
  if (gaps.length < MIN_GAPS) return null;
  const byDay = new Map<string, number>();
  gaps.forEach((g, i) => {
    const day = ends ? isoDate(new Date(ends[i])) : String(i);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, g));
  });
  if (ends && byDay.size < MIN_DAYS) return null;
  const median = quantile(sortNum(gaps), 0.5);
  const longest = quantile(sortNum([...byDay.values()]), 0.9);
  return { samples: gaps.length, medianMin: median, usualLongestMin: longest, thresholdMin: Math.max(longest * 1.5, median * 6, floorMin) };
}

/** The baseline of a source's arrivals (`baselineOf` over their gaps, by the days they end on). */
export function historyBaseline(times: number[], a: Activity, floorMin: number): Baseline | null {
  const gaps = gapsWithEnds(times, a);
  return baselineOf(gaps.map((g) => g.min), floorMin, gaps.map((g) => g.end));
}

/** A step as the health check sees it: its schedule, how its runs went, what its source brought (arrival times, ms). */
export type StepInput = {
  key: string;
  label: string;
  href: string;
  /** Minutes between runs by itself; 0: only by hand. */
  everyMinutes: number;
  /** Runs by itself on workdays only. */
  workdays: boolean;
  /** Doesn't run by itself in the quiet hours (all but the news). */
  quietHours: boolean;
  /** Runs with the briefing (its staleness is the briefing's). */
  chained: boolean;
  running: boolean;
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  failures: number;
  failingSince: string | null;
  lastOkAt: string | null;
  /** The app's last contract check, when it found something (WhatsApp, Signal). */
  drift: { ok: boolean; summary: string; at: string } | null;
  /** When its items came (ms) — the last weeks; null: no source of items of its own. */
  arrivals: number[] | null;
  /** Your days off (local "YYYY-MM-DD") — they count for a work source like weekends. */
  skipDays?: ReadonlySet<string>;
};

export type HealthDetail =
  | { kind: "ok" }
  | { kind: "failing"; failures: number; message: string }
  | { kind: "drift"; broken: boolean; summary: string }
  | { kind: "stale"; overdueMin: number; everyMinutes: number }
  | { kind: "silent"; quietMin: number; usualMin: number }
  | { kind: "thin"; recentPerDay: number; usualPerDay: number };

export type SourceHealth = {
  key: string;
  label: string;
  href: string;
  state: HealthState;
  /** ISO: since when it is so (the first failure, the last run, the last item, the contract check). */
  since: string | null;
  detail: HealthDetail;
  lastAt: string | null;
  lastOkAt: string | null;
  /** ISO: when the newest item came. */
  lastNewAt: string | null;
  baseline: Baseline | null;
  /** Items a day, the last 14 days (oldest first, today last); null: no source of items. */
  perDay: number[] | null;
  everyMinutes: number;
};

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const median = (xs: number[]) => quantile(sortNum(xs), 0.5);

/** Items per local day over the `days` days up to `now` (oldest first). */
function countsByDay(times: number[], now: number, days: number): { date: Date; n: number }[] {
  const out: { date: Date; n: number }[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  const index = new Map<string, number>();
  for (let i = 0; i < days; i++, d.setDate(d.getDate() + 1)) {
    index.set(isoDate(d), i);
    out.push({ date: new Date(d), n: 0 });
  }
  for (const x of times) {
    const i = index.get(isoDate(new Date(x)));
    if (i !== undefined) out[i].n++;
  }
  return out;
}

/**
 * Far fewer than usual: the last two complete active days brought under a fifth of a usual active day (the median of the
 * four weeks before, from the first item on) — for a source that brings at least 8 a day, while its runs went through.
 */
function thin(times: number[], now: number, a: Activity, lastOkAt: number): { recentPerDay: number; usualPerDay: number } | null {
  const first = Math.min(...times);
  const days = countsByDay(times, now, 29).slice(0, -1).filter((x) => !dayOff(x.date, a) && x.date.getTime() + DAY > first);
  if (days.length < 10) return null;
  const recent = days.slice(-2);
  const usual = median(days.slice(0, -2).map((x) => x.n));
  const recentPerDay = (recent[0].n + recent[1].n) / 2;
  const lastDayEnd = recent[1].date.getTime() + DAY;
  if (usual >= 8 && recentPerDay < usual * 0.2 && lastOkAt >= lastDayEnd) return { recentPerDay, usualPerDay: usual };
  return null;
}

/** One step's health now. `upSince`: since when the server (its scheduler) runs — before it, no run was missed. */
export function judgeStep(s: StepInput, ctx: { now: number; upSince: number; quiet?: { from: number; to: number } }): SourceHealth {
  const quiet = ctx.quiet ?? DEFAULT_QUIET;
  const now = ctx.now;
  const arrivals = s.arrivals ? s.arrivals.filter((x) => Number.isFinite(x) && x <= now && x >= now - 42 * DAY) : null;
  const lastNew = arrivals?.length ? Math.max(...arrivals) : NaN;
  const base: Omit<SourceHealth, "state" | "since" | "detail"> = {
    key: s.key,
    label: s.label,
    href: s.href,
    lastAt: s.lastAt,
    lastOkAt: s.lastOkAt,
    lastNewAt: Number.isFinite(lastNew) ? iso(lastNew) : null,
    baseline: null,
    perDay: arrivals ? countsByDay(arrivals, now, 14).map((x) => x.n) : null,
    everyMinutes: s.everyMinutes,
  };
  const ok = (): SourceHealth => ({ ...base, state: "ok", since: null, detail: { kind: "ok" } });
  // Running right now: its run may be fixing it.
  if (s.running) return ok();

  if (s.failures > 0 && s.failingSince && (s.failures >= FAIL_RUNS || now - ms(s.failingSince) >= FAIL_HOURS * 3600e3))
    return { ...base, state: "failing", since: s.failingSince, detail: { kind: "failing", failures: s.failures, message: s.lastMessage ?? "" } };

  if (s.drift) return { ...base, state: "drift", since: s.drift.at, detail: { kind: "drift", broken: !s.drift.ok, summary: s.drift.summary } };

  if (s.everyMinutes > 0 && !s.chained) {
    const ref = Math.max(Number.isFinite(ms(s.lastAt)) ? ms(s.lastAt) : 0, ctx.upSince);
    const overdue = activeMinutes(ref, now, { quiet: s.quietHours ? quiet : null, weekends: !s.workdays });
    if (overdue > s.everyMinutes * 3 + 60) return { ...base, state: "stale", since: s.lastAt, detail: { kind: "stale", overdueMin: Math.round(overdue), everyMinutes: s.everyMinutes } };
  }

  const lastOkAt = ms(s.lastOkAt ?? (s.lastOk ? s.lastAt : null));
  if (arrivals?.length && Number.isFinite(lastOkAt)) {
    const work = weekendsQuiet(arrivals);
    const a: Activity = { quiet, weekends: !work, skipDays: work ? s.skipDays : undefined };
    const b = historyBaseline(arrivals, a, Math.max(120, s.everyMinutes * 4));
    base.baseline = b;
    if (b && lastOkAt > lastNew) {
      const quietMin = activeMinutes(lastNew, lastOkAt, a);
      if (quietMin > b.thresholdMin) return { ...base, state: "silent", since: iso(lastNew), detail: { kind: "silent", quietMin: Math.round(quietMin), usualMin: Math.round(b.thresholdMin) } };
    }
    const few = thin(arrivals, now, a, lastOkAt);
    if (few) return { ...base, state: "silent", since: null, detail: { kind: "thin", ...few } };
  }
  return ok();
}

/** An open incident: a step not ok, since when it is so (as first seen). */
export type Incident = { state: HealthState; openedAt: string };

/**
 * The incidents after a check: a step newly not ok (or in another bad state) opens one — `opened`, to be told once;
 * the same state again is the same incident; a step ok again (or gone) closes it.
 */
export function trackIncidents(prev: Record<string, Incident>, current: { key: string; state: HealthState }[], nowIso: string): { next: Record<string, Incident>; opened: string[] } {
  const next: Record<string, Incident> = {};
  const opened: string[] = [];
  for (const c of current) {
    if (c.state === "ok") continue;
    const was = prev[c.key];
    if (was && was.state === c.state) next[c.key] = was;
    else {
      next[c.key] = { state: c.state, openedAt: nowIso };
      opened.push(c.key);
    }
  }
  return { next, opened };
}

/** "3 h" / "2 d" — active time, roughly. */
function span(t: T, min: number): string {
  if (min < 120) return t("{n} min", { n: Math.round(min) });
  if (min < 48 * 60) return t("{n} h", { n: Math.round(min / 60) });
  return t("{n} d", { n: Math.round(min / 1440) });
}

/** The state in a word. */
export function healthLabel(t: T, state: HealthState): string {
  return state === "failing" ? t("failing") : state === "drift" ? t("app changed") : state === "stale" ? t("not running") : state === "silent" ? t("silent") : t("ok");
}

/** Why, in one line. */
export function healthReason(t: T, h: Pick<SourceHealth, "detail">): string {
  const d = h.detail;
  switch (d.kind) {
    case "failing":
      return t("Failed {n} times in a row: {message}", { n: d.failures, message: d.message.slice(0, 200) });
    case "drift":
      return d.broken ? t("The app changed, a sync may fail — {summary}", { summary: d.summary.slice(0, 200) }) : t("The app changed, it still works through a fallback — {summary}", { summary: d.summary.slice(0, 200) });
    case "stale":
      return t("No run for {span} though it runs every {every} min — is it stopped (Chrome, Signal not running)?", { span: span(t, d.overdueMin), every: d.everyMinutes });
    case "silent":
      return t("Runs say ok, but nothing new for {span} (usual at most {usual}) — the site may have changed", { span: span(t, d.quietMin), usual: span(t, d.usualMin) });
    case "thin":
      return t("Runs say ok, but only {recent} a day lately (usual {usual}) — the site may have changed", { recent: Math.round(d.recentPerDay * 10) / 10, usual: Math.round(d.usualPerDay) });
    default:
      return t("ok");
  }
}
