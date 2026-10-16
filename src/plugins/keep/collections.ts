import { getSqlite } from "@/db";
import { getPref } from "@/lib/prefs";
import type { CollectionProvider } from "@/lib/items/point";
import type { Collection, Item } from "@/lib/items/shared";
import { isInstalled } from "@/plugins/state";
import { listKeepBoards, listOwnNotes, notesByRefs, updateKeepBoard, type NoteView } from "./boards";
import { allKeepNotes, keepCount, type KeepNote } from "./store";

/**
 * Your Keep boards (keep:board:<id>) and Google Keep (keep:google, once notes are synced) as
 * collections of notes. Google Keep's can be changed in Zeff only with Google Keep write.
 */

const GOOGLE = "keep:google";

/** Google Keep kept in a Workspace database (see ./google-workspace): the Workspace answers for its notes then. */
function googleMirrored(): boolean {
  const id = getPref<number | null>("keep.googleDb", null);
  if (!id) return false;
  return !!getSqlite().prepare("select 1 from sqlite_master where name = 'ws_pages'").get() && !!getSqlite().prepare("select 1 from ws_pages where id = ? and archived_at is null").get(id);
}

/** Your notes moved into the Workspace (keep:n<id>) — the Workspace answers for them now (see ./to-workspace). */
function movedRefs(): Set<string> {
  const d = getSqlite();
  if (!d.prepare("select 1 from sqlite_master where name = 'keep_moved'").get()) return new Set();
  return new Set((d.prepare("select note_id from keep_moved").all() as { note_id: number }[]).map((r) => `keep:n${r.note_id}`));
}

const toItem = (n: NoteView | (KeepNote & { ref: string; boardId: null }), collectionId: string): Item => ({
  ref: n.ref,
  key: null,
  collectionId,
  kind: "note",
  title: n.title,
  text: n.text,
  labels: n.labels,
  status: null,
  due: null,
  assignee: null,
  color: n.color,
  pinned: n.pinned,
  archived: n.archived,
  parentRef: null,
  href: n.url,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});
const ownId = (boardId: number) => `keep:board:${boardId}`;
const googleNote = (n: KeepNote) => ({ ...n, ref: `keep:${n.id}`, boardId: null });

export const keepCollections: CollectionProvider = {
  collections() {
    const own = listKeepBoards().map(
      (b): Collection => ({
        id: ownId(b.id),
        plugin: "keep",
        kind: "notes",
        name: b.name,
        description: b.description,
        color: b.color,
        href: `/keep/${b.id}`,
        readOnly: false,
        briefing: b.inLage,
        knowledge: b.inKnowledge,
        space: `Keep · ${b.name}`,
        items: b.notes,
      }),
    );
    if (!keepCount() || googleMirrored()) return own;
    const google: Collection = {
      id: GOOGLE,
      plugin: "keep",
      kind: "notes",
      name: "Google Keep",
      description: "",
      color: null,
      href: "/keep",
      readOnly: !isInstalled("keep-write"),
      briefing: true,
      knowledge: true,
      items: allKeepNotes().filter((n) => !n.archived).length,
    };
    return [...own, google];
  },
  items(id, { archived = false } = {}) {
    if (id === GOOGLE) return keepCount() && !googleMirrored() ? allKeepNotes().filter((n) => archived || !n.archived).map((n) => toItem(googleNote(n), GOOGLE)) : null;
    const m = /^keep:board:(\d+)$/.exec(id);
    if (!m || !listKeepBoards().some((b) => b.id === Number(m[1]))) return null;
    const board = Number(m[1]);
    return [...listOwnNotes(board), ...(archived ? listOwnNotes(board, { archived: true }) : [])].map((n) => toItem(n, id));
  },
  set(id, patch) {
    if (id === GOOGLE) throw new Error("Google Keep is always in the briefing and the knowledge.");
    const m = /^keep:board:(\d+)$/.exec(id);
    if (!m || !listKeepBoards().some((b) => b.id === Number(m[1]))) return false;
    updateKeepBoard(Number(m[1]), { inLage: patch.briefing, inKnowledge: patch.knowledge });
    return true;
  },
  byKeys: () => [],
  act: () => null,
  byRefs: (refs) => {
    const moved = movedRefs();
    const mirrored = googleMirrored();
    return notesByRefs(refs.filter((r) => !moved.has(r) && !(mirrored && !/^keep:n\d+$/.test(r)))).map((n) => toItem(n, n.boardId ? ownId(n.boardId) : GOOGLE));
  },
};
