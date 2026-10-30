import { getSqlite } from "@/db";
import { currentAccountId } from "@/db/accounts";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { syncHealthRecords } from "./health";
import type { SyncView } from "./shared";
import { DEFAULT_QUIET, healthLabel, healthReason, judgeStep, trackIncidents, type HealthState, type Incident, type SourceHealth } from "./source-health-shared";
import { localDay } from "@/lib/dates";

/**
 * Source health from the data (see source-health-shared.ts for how it judges): each step's runs (the sync menu's record and
 * the history of failures, src/lib/sync/health.ts), its schedule, and when its items came — read from the source's own
 * table (mail, WhatsApp, Signal, Teams, GitLab, Jira, Google Keep, the news). The incidents (a step newly not ok) are kept
 * per account (a pref) so each is told once: Heute's line, the sync menu's dot, a notification.
 */

const DRIFT = "source-drift";
const INCIDENTS = "source-health-incidents";

/** The steps that run with the briefing — they aren't stale on their own (the briefing is). */
const CHAINED = new Set(["mailtodos", "relations", "notetodos", "noterelations", "doctodos", "docrelations", "knowledgerel", "peoplenorm", "tododupes", "autoactions", "boardlage"]);

/** "2026-10-21 16:27:04 Mitteleuropäische Sommerzeit" (Jira's, local) or ISO → ms (NaN when unreadable). */
export function parseItemTime(s: string | null | undefined): number {
  if (!s) return NaN;
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)(?: [^\d+-].*)?$/.exec(s);
  if (local) return new Date(`${local[1]}T${local[2]}`).getTime();
  return Date.parse(s);
}

/** Where each source's items are, and the column that says when one came. */
const ARRIVALS: Record<string, string> = {
  mail: "select received_at as t from emails where folder not in ('WhatsApp', 'Signal') and received_at >= ? order by received_at desc limit 20000",
  whatsapp: "select received_at as t from emails where folder = 'WhatsApp' and received_at >= ? order by received_at desc limit 20000",
  signal: "select received_at as t from emails where folder = 'Signal' and received_at >= ? order by received_at desc limit 20000",
  teams: "select sent_at as t from teams_messages where sent_at >= ? order by sent_at desc limit 20000",
  gitlab: "select coalesce(updated_at, created_at) as t from gitlab_items where coalesce(updated_at, created_at) >= ? limit 20000",
  jira: "select updated_at as t from jira_tickets where updated_at >= ? limit 20000",
  keep: "select coalesce(updated_at, created_at) as t from keep_notes where coalesce(updated_at, created_at) >= ? limit 20000",
  news: "select fetched_at as t from news_items where fetched_at >= ? order by fetched_at desc limit 20000",
};

/** When a step's items came (ms), the last six weeks — null for a step without items of its own (or its table not there). */
export function arrivalsOf(key: string, now = Date.now()): number[] | null {
  const q = ARRIVALS[key];
  if (!q) return null;
  const since = new Date(now - 43 * 86400e3).toISOString().slice(0, 10);
  try {
    return (getSqlite().prepare(q).all(since) as { t: string | null }[]).map((r) => parseItemTime(r.t)).filter((x) => Number.isFinite(x));
  } catch {
    return null; // its plugin's table isn't made yet
  }
}

/** Your whole days off (absences), the last six weeks — local "YYYY-MM-DD". */
function daysOff(now: number): Set<string> {
  const out = new Set<string>();
  try {
    const from = localDay(new Date(now - 43 * 86400e3));
    const rows = getSqlite().prepare("select start_date as s, end_date as e from absences where hours is null and end_date >= ?").all(from) as { s: string; e: string }[];
    for (const r of rows)
      for (let d = new Date(`${r.s}T12:00:00`); d <= new Date(`${r.e}T12:00:00`) && out.size < 400; d.setDate(d.getDate() + 1))
        out.add(localDay(d));
  } catch {
    // no absences table: no days off
  }
  return out;
}

type Drift = { ok: boolean; summary: string; at: string };

/** The app's last contract check (WhatsApp's, Signal's status): what it found, or null — all as expected. */
export function noteDrift(key: string, drift: { ok: boolean; summary: string } | null, at = new Date().toISOString()): void {
  const all = getPref<Record<string, Drift>>(DRIFT, {});
  if (!drift) {
    if (!all[key]) return;
    delete all[key];
  } else if (all[key]?.summary === drift.summary && all[key]?.ok === drift.ok) return;
  else all[key] = { ok: drift.ok, summary: drift.summary.slice(0, 400), at };
  setPref(DRIFT, all);
}

/** A step as the menu has it (and whether it runs on workdays only). */
export type HealthStep = Pick<SyncView, "key" | "label" | "href" | "running" | "lastAt" | "lastOk" | "lastMessage" | "everyMinutes"> & { workdays?: boolean };

const ACTIVE_SINCE = "sync-active-since";

/** The scheduler syncs this account from now on (its first turn since the server started) — kept for the stale check. */
export function noteSyncingSince(at = Date.now()): void {
  setPref(ACTIVE_SINCE, at);
}

/**
 * Since when this account's steps run by themselves — before that, no run was missed: the server (its scheduler) started.
 * Every account syncs, the one you're in or not.
 */
function upSince(): number {
  return Math.max(Date.now() - process.uptime() * 1000, getPref<number>(ACTIVE_SINCE, 0));
}

/**
 * Every step's health now — and the incidents kept (a new one opened, a mended one closed). `now`/`upSince` for tests.
 */
export function computeSourceHealth(steps: HealthStep[], opts: { now?: number; upSince?: number } = {}): SourceHealth[] {
  const now = opts.now ?? Date.now();
  const records = syncHealthRecords();
  const drift = getPref<Record<string, Drift>>(DRIFT, {});
  const off = daysOff(now);
  const out = steps.map((s) => {
    const r = records[s.key];
    return judgeStep(
      {
        key: s.key,
        label: s.label,
        href: s.href,
        everyMinutes: s.everyMinutes,
        workdays: !!s.workdays,
        quietHours: s.key !== "news",
        chained: CHAINED.has(s.key),
        running: s.running,
        lastAt: s.lastAt,
        lastOk: s.lastOk,
        lastMessage: r?.message ?? s.lastMessage,
        failures: r?.failures ?? 0,
        failingSince: r?.failingSince ?? null,
        lastOkAt: r?.lastOkAt ?? (s.lastOk ? s.lastAt : null),
        drift: drift[s.key] ?? null,
        arrivals: arrivalsOf(s.key, now),
        skipDays: off,
      },
      { now, upSince: opts.upSince ?? upSince(), quiet: DEFAULT_QUIET },
    );
  });
  keepIncidents(out, new Date(now).toISOString());
  return out;
}

function keepIncidents(health: SourceHealth[], nowIso: string): void {
  const prev = getPref<Record<string, Incident & { label?: string; href?: string; reason?: string }>>(INCIDENTS, {});
  const { next, opened } = trackIncidents(prev, health, nowIso);
  // With the step's name, where it is and why as it opened (the attention list reads only this).
  const byKey = new Map(health.map((h) => [h.key, h]));
  const withNames = Object.fromEntries(
    Object.entries(next).map(([k, v]) => {
      const h = byKey.get(k);
      const reason = opened.includes(k) || !("reason" in v) ? (h ? healthReason(t, h) : "") : (v as { reason?: string }).reason;
      return [k, { ...v, label: h?.label ?? k, href: h?.href ?? "/", reason }];
    }),
  );
  if (JSON.stringify(withNames) !== JSON.stringify(prev)) setPref(INCIDENTS, withNames);
}

/** The incidents open now (cheap: only read) — each with a stable id for "told once". */
export function sourceIncidents(): { id: string; key: string; state: HealthState; openedAt: string; label: string; href: string; reason: string }[] {
  const all = getPref<Record<string, Incident & { label?: string; href?: string; reason?: string }>>(INCIDENTS, {});
  return Object.entries(all).map(([key, v]) => ({ id: `source:${key}:${v.state}:${v.openedAt}`, key, state: v.state, openedAt: v.openedAt, label: v.label ?? key, href: v.href ?? "/", reason: v.reason ?? "" }));
}

/** The steps as the menu has them (only those there are), with their workday flag. */
async function stepsNow(): Promise<HealthStep[]> {
  const { syncOverview } = await import("./registry");
  return syncOverview().steps;
}

/** Cached a minute per account: the menu polls, the pages ask. */
const cache = globalThis as { __zeffSourceHealth?: Map<string, { at: number; health: SourceHealth[] }> };

/** Every step's health (cached for a minute unless `fresh`). */
export async function sourceHealth({ fresh = false } = {}): Promise<SourceHealth[]> {
  const map = (cache.__zeffSourceHealth ??= new Map());
  const account = currentAccountId();
  const hit = map.get(account);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.health;
  const health = computeSourceHealth(await stepsNow());
  map.set(account, { at: Date.now(), health });
  return health;
}

/** The health as text (MCP, API): one line per step — its state, why, when it last ran and when its newest item came. */
export function sourceHealthText(list: SourceHealth[]): string {
  if (!list.length) return "No sources.";
  const bad = list.filter((h) => h.state !== "ok");
  const head = bad.length ? `${bad.length} of ${list.length} sources aren't well — their data may be missing or old.` : `All ${list.length} sources are well.`;
  const lines = list.map((h) => {
    const parts = [`${h.label}: ${healthLabel(t, h.state)} (${h.key}, ${h.state})`];
    if (h.state !== "ok") parts.push(healthReason(t, h));
    parts.push(h.lastAt ? `last run ${h.lastAt}` : "never ran");
    if (h.perDay) parts.push(h.lastNewAt ? `newest item ${h.lastNewAt}` : "no items in the last weeks");
    return `- ${parts.join(" · ")}`;
  });
  return [head, ...lines].join("\n");
}
