/**
 * Documents that wait for you (from a local folder set to "confirm" — folders.ts): their text is read where that needs
 * no AI, but nothing with the AI happens until you confirm — no reading of scans and pictures by Claude, no compiling by
 * the knowledge server, no todos or matching from them. A changed file waits again. Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";

let made = false;
function db() {
  const d = getSqlite();
  if (!made) {
    d.exec("create table if not exists doc_gate (doc_id integer primary key, state text not null, at text not null)");
    made = true;
  }
  return d;
}

/** Hold a document until you confirm it (again, when its file changed). */
export function hold(docId: number): void {
  db().prepare("insert into doc_gate (doc_id, state, at) values (?, 'pending', ?) on conflict(doc_id) do update set state = 'pending', at = excluded.at").run(docId, new Date().toISOString());
}

/** The documents that wait for you. */
export const pendingIds = (): Set<number> => new Set((db().prepare("select doc_id from doc_gate where state = 'pending'").all() as { doc_id: number }[]).map((r) => r.doc_id));

export const isPending = (docId: number): boolean => !!db().prepare("select 1 from doc_gate where doc_id = ? and state = 'pending'").get(docId);

/** You confirmed them: the AI may read, compile and look at them now. */
export function approve(ids: number[]): number {
  const st = db().prepare("update doc_gate set state = 'approved', at = ? where doc_id = ? and state = 'pending'");
  const at = new Date().toISOString();
  let n = 0;
  for (const id of ids) n += st.run(at, id).changes;
  if (n) emitChange("todos");
  return n;
}

/** A document removed: its entry goes too. */
export const forget = (docId: number): void => void db().prepare("delete from doc_gate where doc_id = ?").run(docId);
