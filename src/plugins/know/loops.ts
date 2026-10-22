import { getSqlite } from "@/db";
import { SHOW_FROM } from "@/plugins/people/graph";
import type { BriefLoop } from "./shared";

/**
 * ===========================================================================================================================
 * MERGE POINT — open loops. `openLoopsFor(refs)` is the one place the brief asks "what is still open with these people / from
 * these sources?". For now it reads the People plugin's commitment claims straight from `people_claims` (kind commitment, not
 * done, not rejected or superseded, confirmed or sure enough to show) so it doesn't depend on the open-loops increment
 * (branch intel-loops). When that lands, point this function at its module (its open loops of a person, a mail, a chat) and
 * keep the BriefLoop shape — nothing else in the brief needs to change.
 * ===========================================================================================================================
 *
 * The loops of the people among `refs` (person:<id>), and those read from one of the refs itself (a mail "mail:<key>", a Teams
 * message "teams:<key>" — a claim's source). Mine first, then the overdue, then by due day (none last). `today`: YYYY-MM-DD.
 */
export function openLoopsFor(refs: string[], today = new Date().toISOString().slice(0, 10)): BriefLoop[] {
  const people = [...new Set(refs.flatMap((r) => (/^person:\d+$/.test(r) ? [Number(r.slice(7))] : [])))];
  const sources = [...new Set(refs.filter((r) => /^(mail|teams|jira-comment|doc):/.test(r)))];
  if (!people.length && !sources.length) return [];
  const where = [people.length ? `c.person_id in (${people.map(() => "?").join(",")})` : "", sources.length ? `c.source_ref in (${sources.map(() => "?").join(",")})` : ""].filter(Boolean).join(" or ");
  let rows: { id: number; person_id: number; name: string; direction: string; text: string; due: string; evidence: string; source_ref: string }[] = [];
  try {
    rows = getSqlite()
      .prepare(
        `select c.id, c.person_id, p.name, c.direction, c.text, c.due, c.evidence, c.source_ref from people_claims c join people p on p.id = c.person_id
         where c.kind = 'commitment' and c.done_at is null and c.status in ('proposed', 'confirmed') and (c.status = 'confirmed' or c.confidence >= ?) and (${where})`,
      )
      .all(SHOW_FROM, ...people, ...sources) as typeof rows;
  } catch {
    return []; // (the People plugin's tables not made yet)
  }
  const loops: BriefLoop[] = rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: r.name,
    direction: r.direction === "mine" || r.direction === "theirs" ? r.direction : "",
    text: r.text,
    due: r.due,
    overdue: !!r.due && r.due < today,
    evidence: r.evidence,
    sourceRef: r.source_ref,
  }));
  return loops.sort((a, b) => Number(b.direction === "mine") - Number(a.direction === "mine") || Number(b.overdue) - Number(a.overdue) || (a.due || "9999").localeCompare(b.due || "9999") || a.id - b.id);
}
