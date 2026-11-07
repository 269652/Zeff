import { getSqlite } from "@/db";

/**
 * Whether a work run's session reached Zeff's MCP at all (an agent's worker sends its run in X-Zeff-Run): an agent routine whose
 * worker ended without ever reaching it read and wrote nothing — however it ended — and counts as failed, not as done. Kept in the
 * account's database (a restart in between doesn't forget it). Server only.
 */

function db() {
  const d = getSqlite();
  d.exec("create table if not exists mcp_run_contacts (work_run_id integer primary key, calls integer not null default 0, first_at text not null, last_at text not null)");
  return d;
}

/** A request of this run came in. */
export function noteRunContact(workRunId: number): void {
  const at = new Date().toISOString();
  db().prepare("insert into mcp_run_contacts (work_run_id, calls, first_at, last_at) values (?, 1, ?, ?) on conflict (work_run_id) do update set calls = calls + 1, last_at = excluded.last_at").run(workRunId, at, at);
}

/** Whether this run reached Zeff's MCP at least once. */
export const reachedZeff = (workRunId: number): boolean => !!db().prepare("select 1 from mcp_run_contacts where work_run_id = ?").get(workRunId);
