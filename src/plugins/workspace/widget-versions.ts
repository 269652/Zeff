import { getSqlite } from "@/db";

/**
 * A widget block's versions: every change — built or changed by the AI, its code edited, an older one restored — kept with what was
 * asked, so a widget is improved step by step and any step can be looked at again or brought back. Kept by the block's own id (its
 * `wid` attribute), the newest MAX_VERSIONS. The AI reads the requests so far when it changes a widget (widget-make.ts). Server only.
 */

export const MAX_VERSIONS = 60;

export type VersionSource = "ai" | "code" | "restore" | "fix" | "first";
export type WidgetVersion = {
  n: number;
  at: string;
  source: VersionSource;
  prompt: string;
  title: string;
  html: string;
  libs: string[];
  writes: number[];
  ai: boolean;
  flows: string[];
  note: string;
};
export type VersionSummary = Omit<WidgetVersion, "html"> & { size: number };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_widget_versions (id integer primary key autoincrement, wid text not null, n integer not null, page_id integer, at text not null, source text not null, prompt text not null default '', title text not null default '', html text not null, libs text not null default '', writes text not null default '', ai integer not null default 0, flows text not null default '', note text not null default '');
    create unique index if not exists ws_widget_versions_wid_n on ws_widget_versions (wid, n);
  `);
  return d;
}

type VRow = { n: number; at: string; source: string; prompt: string; title: string; html: string; libs: string; writes: string; ai: number; flows: string; note: string };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const toVersion = (r: VRow): WidgetVersion => ({
  n: r.n,
  at: r.at,
  source: r.source as VersionSource,
  prompt: r.prompt,
  title: r.title,
  html: r.html,
  libs: csv(r.libs),
  writes: csv(r.writes).map(Number),
  ai: !!r.ai,
  flows: csv(r.flows),
  note: r.note,
});

export const isWid = (wid: unknown): wid is string => typeof wid === "string" && /^[a-z0-9]{8,24}$/.test(wid);

/** A new id for a block's versions. */
export const newWid = (): string => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 18);

/**
 * A version kept — unless it is the same code as the newest (a restore of the newest, a save without a change): then that one, as it
 * was. Older ones beyond MAX_VERSIONS go.
 */
export function addVersion(wid: string, v: { source: VersionSource; prompt?: string; title?: string; html: string; libs?: string[]; writes?: number[]; ai?: boolean; flows?: string[]; note?: string; pageId?: number | null }): WidgetVersion {
  if (!isWid(wid)) throw new Error("Not a widget block.");
  const d = db();
  const last = d.prepare("select * from ws_widget_versions where wid = ? order by n desc limit 1").get(wid) as VRow | undefined;
  if (last && last.html === v.html && last.title === (v.title ?? "")) return toVersion(last);
  const n = (last?.n ?? 0) + 1;
  d.prepare("insert into ws_widget_versions (wid, n, page_id, at, source, prompt, title, html, libs, writes, ai, flows, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    wid,
    n,
    v.pageId ?? null,
    new Date().toISOString(),
    v.source,
    (v.prompt ?? "").slice(0, 4000),
    (v.title ?? "").slice(0, 80),
    v.html,
    (v.libs ?? []).join(","),
    (v.writes ?? []).join(","),
    v.ai ? 1 : 0,
    (v.flows ?? []).join(","),
    (v.note ?? "").slice(0, 500),
  );
  d.prepare("delete from ws_widget_versions where wid = ? and n <= ?").run(wid, n - MAX_VERSIONS);
  return toVersion(d.prepare("select * from ws_widget_versions where wid = ? and n = ?").get(wid, n) as VRow);
}

/** A block's versions, newest first, without their code (its size instead). */
export function listVersions(wid: string): VersionSummary[] {
  if (!isWid(wid)) return [];
  return (db().prepare("select * from ws_widget_versions where wid = ? order by n desc").all(wid) as VRow[]).map((r) => {
    const { html, ...rest } = toVersion(r);
    return { ...rest, size: html.length };
  });
}

export function getVersion(wid: string, n: number): WidgetVersion | null {
  if (!isWid(wid)) return null;
  const r = db().prepare("select * from ws_widget_versions where wid = ? and n = ?").get(wid, Math.floor(Number(n))) as VRow | undefined;
  return r ? toVersion(r) : null;
}

/** What was asked of a widget so far (oldest first) — the AI reads it when it changes the widget again. */
export function requestsSoFar(wid: string, limit = 10): string[] {
  if (!isWid(wid)) return [];
  return (db().prepare("select prompt, source from ws_widget_versions where wid = ? and prompt != '' order by n desc limit ?").all(wid, limit) as { prompt: string; source: string }[])
    .reverse()
    .map((r) => (r.source === "fix" ? `(fix) ${r.prompt}` : r.prompt));
}
