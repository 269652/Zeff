import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";

/**
 * Which documents you have seen: a document is unread until you open it (its file), tick the unread box off in the Workspace's
 * documents inbox or mark it. Kept beside the documents (a table of its own, made on first use) - nothing about a document's own
 * row changes. The documents there when this began count as seen: the inbox starts empty and fills with what comes. Server only.
 */

const BASELINE = "documents.seenBaseline";
const BASELINE_RECENT = "documents.seenBaseline.recent";
/** Documents added within this many days are unread when the inbox begins - older ones count as seen. */
const RECENT_DAYS = 7;
const cutoff = () => new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists document_seen (doc_id integer primary key, at text not null)");
  return sqlite;
}

/**
 * The documents from before the inbox count as seen - those of the last week stay unread (they are what it is for) - once,
 * the first time unread state is asked for. (A first version marked every document as seen: the recent ones are mended once.)
 */
function baseline(): void {
  const sqlite = table();
  if (!getPref<boolean>(BASELINE, false)) {
    sqlite.prepare("insert or ignore into document_seen (doc_id, at) select id, ? from documents where created_at < ?").run(new Date().toISOString(), cutoff());
    setPref(BASELINE, true);
    setPref(BASELINE_RECENT, true);
    return;
  }
  if (getPref<boolean>(BASELINE_RECENT, false)) return;
  const first = (sqlite.prepare("select min(at) as at from document_seen").get() as { at: string | null }).at;
  if (first) sqlite.prepare("delete from document_seen where at = ? and doc_id in (select id from documents where created_at >= ?)").run(first, cutoff());
  setPref(BASELINE_RECENT, true);
}

/** The ids of the documents you have not seen. */
export function unreadIds(): Set<number> {
  baseline();
  const sqlite = table();
  const all = (sqlite.prepare("select id from documents").all() as { id: number }[]).map((r) => r.id);
  const seen = new Set((sqlite.prepare("select doc_id from document_seen").all() as { doc_id: number }[]).map((r) => r.doc_id));
  return new Set(all.filter((id) => !seen.has(id)));
}

export const isUnread = (id: number): boolean => unreadIds().has(id);

/** Seen: opened, ticked off, marked. The documents databases follow. */
export function markSeen(ids: number[]): void {
  baseline();
  const sqlite = table();
  const at = new Date().toISOString();
  const ins = sqlite.prepare("insert or ignore into document_seen (doc_id, at) values (?, ?)");
  sqlite.transaction(() => ids.forEach((id) => ins.run(id, at)))();
  refresh();
}

/** Unread again (marked so by you). */
export function markUnread(ids: number[]): void {
  baseline();
  const sqlite = table();
  const del = sqlite.prepare("delete from document_seen where doc_id = ?");
  sqlite.transaction(() => ids.forEach((id) => del.run(id)))();
  refresh();
}

/** The Workspace's documents databases read again (a document came, was opened or marked) - in the background. */
const timer = globalThis as unknown as { __zeffDocRefresh?: ReturnType<typeof setTimeout> | null };
export function refresh(): void {
  // Several changes in a moment (a batch read one after the other): one refresh after them.
  if (timer.__zeffDocRefresh) clearTimeout(timer.__zeffDocRefresh);
  timer.__zeffDocRefresh = setTimeout(() => {
    timer.__zeffDocRefresh = null;
    void import("@/plugins/workspace/document-databases").then((m) => m.refreshDocumentDatabases()).catch(() => undefined);
  }, 1500);
}
