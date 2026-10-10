import { getSqlite } from "@/db";
import { extensionInstalled } from "@/plugins/extension-state";
import { isInstalled } from "@/plugins/state";
import { notesByRefs, lageNotes, type NoteView } from "./boards";

/**
 * Notes in the Ticket-Lage (Google Keep's extension "Notizen in der Ticket-Lage"): per ticket, the
 * notes its open todos came from or are related to, and those that name the ticket — the newest
 * few, as lines for its block in the prompt.
 */

const MAX = 6;

/** The note refs the ticket's open todos carry (their source, their related notes). */
function todoNoteRefs(key: string): string[] {
  const rows = getSqlite()
    .prepare("select refs, mail_refs from todos where status = 'open' and (ticket = ? or also_tickets like ?)")
    .all(key, `%"${key}"%`) as { refs: string; mail_refs: string }[];
  const out = new Set<string>();
  for (const r of rows)
    for (const col of [r.refs, r.mail_refs])
      try {
        for (const ref of JSON.parse(col) as unknown[]) if (typeof ref === "string" && ref.startsWith("keep:")) out.add(ref);
      } catch {
        // none
      }
  return [...out];
}

/** Whether notes go into the Lage: Keep and its extension on. */
export const notesInLage = () => isInstalled("keep") && extensionInstalled("keep:lage-context");

let cache: { at: number; notes: NoteView[] } | null = null;
/** All notes the Lage may read — kept for a minute (one run reads them per ticket). */
const allNotes = () => {
  if (!cache || Date.now() - cache.at > 60000) cache = { at: Date.now(), notes: lageNotes() };
  return cache.notes;
};

/** The ticket's notes as prompt lines ([] when none, or notes aren't in the Lage). */
export function lageNoteLines(key: string, chars: number, cut: (s: string, n: number) => string): string[] {
  if (!notesInLage()) return [];
  const linked = notesByRefs(todoNoteRefs(key));
  const re = new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-]/g, "\\-")}(?![0-9])`, "i");
  const naming = allNotes().filter((n) => re.test(`${n.title}\n${n.text}`));
  const notes = [...new Map([...linked, ...naming].map((n) => [n.ref, n])).values()]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MAX);
  if (!notes.length) return [];
  return [
    `Notizen zu ${key} (Google Keep, deine Keep-Boards — neueste zuerst):`,
    ...notes.map((n) => `- [${n.ref}] ${(n.updatedAt ?? "").slice(0, 10)} (${n.source === "google" ? "Google Keep" : (n.boardName ?? "Keep")}) „${cut(n.title || "(ohne Titel)", 160)}“ — ${cut(n.text, chars)}`),
  ];
}
