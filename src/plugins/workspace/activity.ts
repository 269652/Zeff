import { getSqlite } from "@/db";
import { inAgentScope } from "./agent-scope";
import { causeNow } from "@/lib/cause";
import { isQuiet } from "./events";
import { currentAccountId } from "@/db/accounts";
import { flatSlice } from "@/lib/text";

/**
 * What happened to a page or a row, one line each: a field changed (from → to), the title, the text edited, put in the trash and
 * back - and who did it: you, the AI (an agent's tool, the assistant), or a source (a pipeline or a routine reading its records). Kept
 * beside the pages (a table of its own, made on first use), the last 300 per page. Server only.
 */

export type Actor = "you" | "ai" | "source";
/** `cause`: what made it (cause.ts) — a routine, a field filled by itself after it …; null: by hand. */
export type ActivityLine = { id: number; at: string; actor: Actor; field: string; from: string; to: string; cause: string | null };

const KEEP = 300;
/** Done for these accounts' databases (each its own — two accounts run side by side). */
const hasCause = new Set<string>();
const SAME_TEXT_MS = 10 * 60000;

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists ws_activity (id integer primary key autoincrement, page_id integer not null, at text not null, actor text not null, field text not null, old text not null default '', new text not null default '')");
  sqlite.exec("create index if not exists ws_activity_page on ws_activity (page_id, id)");
  // (The cause came later: added to a table from before.)
  if (!hasCause.has(currentAccountId())) {
    if (!(sqlite.prepare("pragma table_info(ws_activity)").all() as { name: string }[]).some((c) => c.name === "cause")) sqlite.exec("alter table ws_activity add column cause text");
    hasCause.add(currentAccountId());
  }
  return sqlite;
}

const actorNow = (): Actor => (inAgentScope() ? "ai" : isQuiet() ? "source" : "you");
const clip = (s: unknown) => flatSlice(s, 240);

/** A change told: `field` is a property's name, or "title", "text", "created", "trash", "restored". Nothing is told when nothing changed. */
export function logChange(pageId: number, field: string, from: unknown = "", to: unknown = ""): void {
  try {
    const a = clip(from);
    const b = clip(to);
    if (field !== "created" && field !== "trash" && field !== "restored" && field !== "text" && a === b) return;
    const sqlite = table();
    const actor = actorNow();
    // Typing in a page is one line, not one per keystroke.
    const cause = causeNow();
    if (field === "text") {
      const last = sqlite.prepare("select id, at, actor, field, cause from ws_activity where page_id = ? order by id desc limit 1").get(pageId) as { id: number; at: string; actor: string; field: string; cause: string | null } | undefined;
      if (last && last.field === "text" && last.actor === actor && last.cause === cause && Date.now() - Date.parse(last.at) < SAME_TEXT_MS) {
        sqlite.prepare("update ws_activity set at = ? where id = ?").run(new Date().toISOString(), last.id);
        return;
      }
    }
    sqlite.prepare("insert into ws_activity (page_id, at, actor, field, old, new, cause) values (?, ?, ?, ?, ?, ?, ?)").run(pageId, new Date().toISOString(), actor, field, a, b, cause);
    sqlite.prepare("delete from ws_activity where page_id = ? and id not in (select id from ws_activity where page_id = ? order by id desc limit ?)").run(pageId, pageId, KEEP);
  } catch {
    // The history never stops a change.
  }
}

/** The field types whose old value the log holds completely enough to put back (it keeps their text). */
const RESTORABLE = ["text", "markdown", "number", "select", "status", "date", "checkbox", "url", "email", "phone"];

/** A change undone: the cell (or the title) gets the value it had. Throws when the line can't be put back - then nothing changes. */
export async function restoreChange(lineId: number): Promise<{ field: string; value: string }> {
  const line = table().prepare("select page_id, field, old, new from ws_activity where id = ?").get(lineId) as { page_id: number; field: string; old: string; new: string } | undefined;
  if (!line) throw new Error("That change is no longer in the history.");
  const store = await import("./store");
  const row = store.getPage(line.page_id);
  if (!row) throw new Error("This page is gone.");
  if (line.old.length >= 240) throw new Error("The old value is too long to be put back from the history.");
  if (line.field === "title") {
    store.updatePage(row.id, { title: line.old });
    return { field: line.field, value: line.old };
  }
  const p = row.dbId ? store.getDatabase(row.dbId)?.schema.properties.find((x) => x.name === line.field) : undefined;
  if (!p) throw new Error("That field is gone.");
  if (!RESTORABLE.includes(p.type)) throw new Error("This kind of field can't be put back from the history.");
  let value: unknown = line.old === "" ? null : line.old;
  if (p.type === "checkbox") value = /^(true|yes|1|✓|✔|checked)$/i.test(line.old);
  else if ((p.type === "select" || p.type === "status") && line.old !== "") {
    value = p.options?.find((o) => o.name === line.old)?.id;
    if (!value) throw new Error("That choice is gone from the field.");
  }
  store.setCell(row.id, p.id, value);
  return { field: line.field, value: line.old };
}

/** The newest line's id now (0: none) — what a dry run reads its changes after. */
export const lastActivityId = (): number => (table().prepare("select coalesce(max(id), 0) n from ws_activity").get() as { n: number }).n;

/** Every line after `id`, oldest first, with its page's title. */
export function activitySince(id: number): (ActivityLine & { pageId: number; title: string })[] {
  return (
    table()
      .prepare("select a.id, a.page_id, a.at, a.actor, a.field, a.old, a.new, a.cause, coalesce(p.title, '') title from ws_activity a left join ws_pages p on p.id = a.page_id where a.id > ? order by a.id")
      .all(id) as { id: number; page_id: number; at: string; actor: Actor; field: string; old: string; new: string; cause: string | null; title: string }[]
  ).map((r) => ({ id: r.id, pageId: r.page_id, title: r.title, at: r.at, actor: r.actor, field: r.field, from: r.old, to: r.new, cause: r.cause ?? null }));
}

/** The newest lines of a page or row, newest first. */
export function activityOf(pageId: number, limit = 30): ActivityLine[] {
  return (table().prepare("select id, at, actor, field, old, new, cause from ws_activity where page_id = ? order by id desc limit ?").all(pageId, Math.max(1, Math.min(200, limit))) as { id: number; at: string; actor: Actor; field: string; old: string; new: string; cause: string | null }[]).map((r) => ({ id: r.id, at: r.at, actor: r.actor, field: r.field, from: r.old, to: r.new, cause: r.cause ?? null }));
}
