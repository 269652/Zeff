import fs from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { errPath, inPath, logPath, workDir } from "./log";
import { isActive, type WorkStatus } from "./shared";

/**
 * Sessions put away (the sidebar's ⋯): archived — out of the sidebar, back with "Show archived" —
 * or deleted: the conversation's runs and their logs gone (its todo stays). A session is a todo's
 * conversation: all runs on it.
 */

const KEY = "workArchivedSessions";

/** The todos whose sessions you archived. */
export function archivedSessions(): Set<number> {
  return new Set(getPref<number[]>(KEY, []).filter((x) => Number.isInteger(x)));
}

export function setSessionArchived(todoId: number, archived: boolean): void {
  const s = archivedSessions();
  if (archived) s.add(todoId);
  else s.delete(todoId);
  setPref(KEY, [...s]);
  emitChange("work");
}

/** A session gone: its runs and their logs (none may be at work) — its todo stays. How many runs. */
export function deleteSession(todoId: number): number {
  const { workRuns } = schema;
  const db = getDb();
  const runs = db.select({ id: workRuns.id, status: workRuns.status }).from(workRuns).where(inArray(workRuns.todoId, [todoId])).all();
  if (runs.some((r) => isActive(r.status as WorkStatus))) throw new Error(t("The session is working — stop it first."));
  const ids = runs.map((r) => r.id);
  if (ids.length) db.delete(workRuns).where(inArray(workRuns.id, ids)).run();
  // Its files: the logs, Zeff's side log, a live session's own files (config, choices).
  const sessions = path.join(workDir(), "sessions");
  for (const id of ids)
    for (const f of [logPath(id), errPath(id), inPath(id), path.join(sessions, `${id}.json`), path.join(sessions, `${id}.opts.json`), path.join(sessions, `${id}.host-cfg.json`)])
      fs.rmSync(/*turbopackIgnore: true*/ f, { force: true });
  setSessionArchived(todoId, false);
  emitChange("work");
  return ids.length;
}
