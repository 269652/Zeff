import { getSqlite } from "@/db";
import { inAgentScope } from "./agent-scope";
import type { WorkspacePackage } from "./packages";

/**
 * Save points of a whole app (an installed package): the state of its top page and every page below it at one moment — pages, databases'
 * fields and views, flows, forms, routines; not the entries — kept so the whole app can go back to it, or become a new app or a template.
 * Made on a click ("Keep the current state"), and by themselves before an update, a roll-back or a restore, so each of those can be undone.
 * Beside the versions an install or update keeps (package-registry.ts, by version number). The newest SAVE_POINTS_KEPT per app. Server only.
 */

export const SAVE_POINTS_KEPT = 30;
const MAX_BYTES = 2_000_000;

export type SavePoint = { n: number; app: string; at: string; label: string; auto: boolean; by: string; version: string; size: number };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_app_savepoints (id integer primary key autoincrement, app text not null, n integer not null, at text not null, label text not null default '', auto integer not null default 0, by text not null default '', version text not null default '', pkg text not null);
    create unique index if not exists ws_app_savepoints_app_n on ws_app_savepoints (app, n);
  `);
  return d;
}

type Row = { app: string; n: number; at: string; label: string; auto: number; by: string; version: string; pkg: string };
const toPoint = (r: Row & { size?: number }): SavePoint => ({ n: r.n, app: r.app, at: r.at, label: r.label, auto: !!r.auto, by: r.by, version: r.version, size: r.size ?? r.pkg.length });

/** A save point kept (null: the same as the newest, or too large to keep). */
export function addSavePoint(app: string, pkg: WorkspacePackage, v: { label: string; auto: boolean; version: string }): SavePoint | null {
  const body = JSON.stringify(pkg);
  if (body.length > MAX_BYTES) return null;
  const d = db();
  const last = d.prepare("select * from ws_app_savepoints where app = ? order by n desc limit 1").get(app) as Row | undefined;
  if (last && last.pkg === body) return null;
  const n = (last?.n ?? 0) + 1;
  d.prepare("insert into ws_app_savepoints (app, n, at, label, auto, by, version, pkg) values (?, ?, ?, ?, ?, ?, ?, ?)").run(app, n, new Date().toISOString(), v.label.slice(0, 200), v.auto ? 1 : 0, inAgentScope() ? "ai" : "you", v.version, body);
  d.prepare("delete from ws_app_savepoints where app = ? and n <= ?").run(app, n - SAVE_POINTS_KEPT);
  return toPoint(d.prepare("select * from ws_app_savepoints where app = ? and n = ?").get(app, n) as Row);
}

/** An app's save points, newest first (without their content). */
export const savePoints = (app: string): SavePoint[] =>
  (db().prepare("select app, n, at, label, auto, by, version, length(pkg) size, '' pkg from ws_app_savepoints where app = ? order by n desc").all(app) as (Row & { size: number })[]).map(toPoint);

/** One of them with its content. */
export function savePoint(app: string, n: number): (SavePoint & { pkg: WorkspacePackage }) | null {
  const r = db().prepare("select * from ws_app_savepoints where app = ? and n = ?").get(app, n) as Row | undefined;
  return r ? { ...toPoint(r), pkg: JSON.parse(r.pkg) as WorkspacePackage } : null;
}
