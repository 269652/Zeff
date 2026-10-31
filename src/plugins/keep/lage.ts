import { getSqlite } from "@/db";
import { currentAccountId } from "@/db/accounts";
import { briefingNotes, itemsByRefs, placed, type PlacedItem } from "@/lib/items";
import { collectionProviders } from "@/lib/items/point";
import { extensionInstalled } from "@/plugins/extension-state";
import { isInstalled } from "@/plugins/state";

/**
 * Notes in the Ticket-Lage (Google Keep's extension "Notizen in der Ticket-Lage"): per ticket, the
 * notes its open todos came from or are related to, and those that name the ticket — the newest
 * few, as lines for its block in the prompt. Notes are the items of the collections in the briefing
 * (your Keep boards, Google Keep, any other), read through `@/lib/items`.
 */

const MAX = 6;

/** The refs the ticket's open todos carry (their source, their related notes). */
function todoRefs(key: string): string[] {
  const rows = getSqlite()
    .prepare("select refs, mail_refs from todos where status = 'open' and (ticket = ? or also_tickets like ?)")
    .all(key, `%"${key}"%`) as { refs: string; mail_refs: string }[];
  const out = new Set<string>();
  for (const r of rows)
    for (const col of [r.refs, r.mail_refs])
      try {
        for (const ref of JSON.parse(col) as unknown[]) if (typeof ref === "string") out.add(ref);
      } catch {
        // none
      }
  return [...out];
}

/** Whether notes go into the Lage: the Workspace (the notes are its) and its extension on. */
export const notesInLage = () => isInstalled("workspace") && extensionInstalled("notes:lage-context");

let cache: { key: string; at: number; notes: PlacedItem[] } | null = null;
/** All notes the Lage may read — kept for a minute (one run reads them per ticket), per account and installed providers. */
const allNotes = () => {
  const key = `${currentAccountId()}|${collectionProviders.list().map((c) => c.plugin).join(",")}`;
  if (!cache || cache.key !== key || Date.now() - cache.at > 60000) cache = { key, at: Date.now(), notes: briefingNotes() };
  return cache.notes;
};

/** The ticket's notes as prompt lines ([] when none, or notes aren't in the Lage). */
export function lageNoteLines(key: string, chars: number, cut: (s: string, n: number) => string): string[] {
  if (!notesInLage()) return [];
  const linked = placed(itemsByRefs(todoRefs(key)).values()).filter((n) => n.collection.kind !== "board");
  const re = new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-]/g, "\-")}(?![0-9])`, "i");
  const naming = allNotes().filter((n) => re.test(`${n.item.title}\n${n.item.text}`));
  const notes = [...new Map([...linked, ...naming].map((n) => [n.item.ref, n])).values()]
    .sort((a, b) => (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? ""))
    .slice(0, MAX);
  if (!notes.length) return [];
  return [
    `Notizen zu ${key} (Google Keep, deine Keep-Boards — neueste zuerst):`,
    ...notes.map(({ item: n, collection: c }) => `- [${n.ref}] ${(n.updatedAt ?? "").slice(0, 10)} (${c.name}) „${cut(n.title || "(ohne Titel)", 160)}“ — ${cut(n.text, chars)}`),
  ];
}
