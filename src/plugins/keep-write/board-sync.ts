import { createHash } from "node:crypto";
import { sleep } from "@/lib/abort";
import { errorMessage } from "@/lib/errors";
import { getPref, setPref } from "@/lib/prefs";
import { boardNotesForSync, deletedForSync, forgetDeleted, importOwnNote, keepBoard, linkOwnNote, updateOwnNote, type SyncedNote } from "@/plugins/keep/boards";
import { allKeepNotes, type KeepNote } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";
import { createGoogleNote, trashGoogleNote, updateGoogleNote } from "./write";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";
import { currentAccountId } from "@/db/accounts";

/**
 * A board synced with Google Keep (Google Keep schreiben, beta): your board's notes are notes in
 * Keep with the board's name as their label, and stay one — whichever side you change.
 *
 * 1. Keep read anew (the Keep sync), so Zeff knows what's there now.
 * 2. Notes deleted here: into Keep's trash.
 * 3. Each note of the board: not in Keep yet → made there (with the board's label); in Keep →
 *    compared with how both sides were at the last sync (a fingerprint each): changed here only →
 *    written to Keep; changed in Keep only → taken over here; both → the later change wins.
 *    Gone from Keep (deleted, in the trash there) → archived here (not deleted), unlinked.
 * 4. Notes in Keep with the board's label that aren't linked yet: taken into the board.
 *
 * Every write to Keep goes through its own page (slow: about half a minute each) — one board at
 * a time, in the background; how far it is, `boardSyncState`.
 */

type Fields = { title: string; text: string; labels: string[]; color: string | null; pinned: boolean; archived: boolean };

const norm = (t: string) =>
  t
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, "").replace(/^(\s*)[-*]\s\[[xX]\]/, "$1- [x]").replace(/^(\s*)[-*]\s\[ \]/, "$1- [ ]"))
    .join("\n")
    .trim();

/** A side's state, as a fingerprint: what a sync would carry over (the board's label aside — it's always there). */
function fingerprint(f: Fields, boardLabel: string): string {
  const labels = [...new Set(f.labels.map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== boardLabel.toLowerCase()))].sort();
  return createHash("sha1")
    .update(JSON.stringify([f.title.trim(), norm(f.text), labels, f.color || null, !!f.pinned, !!f.archived]))
    .digest("hex");
}

const local = (n: SyncedNote): Fields => ({ title: n.title, text: n.text, labels: n.labels, color: n.color, pinned: n.pinned, archived: n.archived });
const google = (n: KeepNote): Fields => ({ title: n.title, text: n.text, labels: n.labels, color: n.color, pinned: n.pinned, archived: n.archived });
const withLabel = (labels: string[], label: string) => [...new Set([...labels.filter((l) => l.toLowerCase() !== label.toLowerCase()), label])];
const withoutLabel = (labels: string[], label: string) => labels.filter((l) => l.toLowerCase() !== label.toLowerCase());

export type BoardSyncResult = { created: number; pushed: number; pulled: number; imported: number; trashed: number; archived: number; unchanged: number; failed: number; errors: string[] };
type State = { boardId: number; step: string; done: number; total: number; result: BoardSyncResult; startedAt: string };

const PREF = (boardId: number) => `keep-write:board-sync:${boardId}`;

/** How the board's sync stands: running now (how far), or how the last one went. */
export function boardSyncState(boardId: number): { running: State | null; last: { at: string; ok: boolean; message: string } | null } {
  const s = accountFlag<State>("__zeffBoardSync");
  return { running: s && s.boardId === boardId ? s : null, last: getPref<{ at: string; ok: boolean; message: string } | null>(PREF(boardId), null) };
}

const summary = (r: BoardSyncResult) =>
  [
    r.created && `${r.created} created in Keep`,
    r.pushed && `${r.pushed} sent to Keep`,
    r.pulled && `${r.pulled} taken from Keep`,
    r.imported && `${r.imported} brought into the board from Keep`,
    r.trashed && `${r.trashed} moved to Keep's trash`,
    r.archived && `${r.archived} archived here (deleted in Keep)`,
    r.failed && `${r.failed} failed${r.errors.length ? ` (${r.errors[0]})` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ") || "Everything was already the same.";

/** Start the board's sync in the background — false when one runs already. */
export function startBoardSync(boardId: number): boolean {
  if (accountFlag("__zeffBoardSync")) return false;
  if (!isInstalled("keep-write")) throw new Error("\"Google Keep schreiben\" isn't installed (Menu → Plugins).");
  const board = keepBoard(boardId);
  if (!board) throw new Error("That board doesn't exist.");
  const state: State = { boardId, step: "Reading Google Keep …", done: 0, total: 0, result: { created: 0, pushed: 0, pulled: 0, imported: 0, trashed: 0, archived: 0, unchanged: 0, failed: 0, errors: [] }, startedAt: new Date().toISOString() };
  const account = currentAccountId();
  setAccountFlag("__zeffBoardSync", state, account);
  void syncBoard(board.id, board.name, state)
    .then(() => setPref(PREF(boardId), { at: new Date().toISOString(), ok: state.result.failed === 0, message: summary(state.result) }))
    .catch((e) => setPref(PREF(boardId), { at: new Date().toISOString(), ok: false, message: errorMessage(e).slice(0, 300) }))
    .finally(() => {
      setAccountFlag("__zeffBoardSync", null, account);
    });
  return true;
}

async function syncBoard(boardId: number, label: string, state: State): Promise<void> {
  const r = state.result;
  // 1. What Keep has now (a Keep sync already running: waited for).
  const { syncKeep } = await import("@/plugins/keep/sync");
  let read = await syncKeep();
  for (let i = 0; i < 20 && !read.ok && /already running/i.test(read.message); i++) {
    await sleep(15000);
    read = await syncKeep();
  }
  if (!read.ok) throw new Error(`Couldn't read Google Keep: ${read.message}`);
  const inKeep = new Map(allKeepNotes({ linked: true }).map((n) => [n.id, n]));
  const notes = boardNotesForSync(boardId);
  const deleted = deletedForSync().filter((id) => inKeep.has(id));
  const toImport = [...inKeep.values()].filter((n) => n.labels.some((l) => l.toLowerCase() === label.toLowerCase()) && !notes.some((x) => x.googleId === n.id) && !deleted.includes(n.id));
  // What has to go over the wire (the rest is quick).
  state.total = deleted.length + notes.length + toImport.length;
  const fail = (what: string, e: unknown) => {
    r.failed++;
    if (r.errors.length < 5) r.errors.push(`${what}: ${errorMessage(e)}`.slice(0, 200));
  };
  const tick = (step: string) => {
    state.done++;
    state.step = step;
  };

  // 2. Deleted here → Keep's trash.
  for (const id of deleted) {
    state.step = `To Keep's trash: ${inKeep.get(id)?.title || "note"}`;
    try {
      await trashGoogleNote(id);
      forgetDeleted(id);
      r.trashed++;
    } catch (e) {
      fail("Delete", e);
    }
    tick(state.step);
  }
  for (const id of deletedForSync()) if (!inKeep.has(id)) forgetDeleted(id); // gone from Keep already

  // 3. The board's notes.
  for (const n of notes) {
    const name = n.title || n.text.split("\n")[0].slice(0, 40) || "note";
    state.step = name;
    try {
      const mine = fingerprint(local(n), label);
      if (!n.googleId) {
        const made = await createGoogleNote({ ...local(n), labels: withLabel(n.labels, label) });
        linkOwnNote(n.id, made.id, { local: mine, google: fingerprint(google(made), label) });
        r.created++;
      } else {
        const g = inKeep.get(n.googleId);
        if (!g) {
          // Gone from Keep (deleted there, or in its trash): kept here, archived — and no longer linked.
          if (!n.archived) updateOwnNote(n.id, { archived: true });
          linkOwnNote(n.id, null, null);
          r.archived++;
        } else {
          const theirs = fingerprint(google(g), label);
          const changedHere = !n.sync || n.sync.local !== mine;
          const changedThere = !n.sync || n.sync.google !== theirs;
          // Changed on both sides: the later change wins.
          const hereWins = changedHere && (!changedThere || (n.updatedAt ?? "") >= (g.updatedAt ?? ""));
          if (!changedHere && !changedThere) r.unchanged++;
          else if (hereWins) {
            const after = await updateGoogleNote(g.id, { ...local(n), labels: withLabel(n.labels, label) });
            linkOwnNote(n.id, g.id, { local: mine, google: fingerprint(google(after), label) });
            r.pushed++;
          } else {
            const f = google(g);
            updateOwnNote(n.id, { title: f.title, text: f.text, labels: withoutLabel(f.labels, label), color: f.color, pinned: f.pinned, archived: f.archived });
            const now = boardNotesForSync(boardId).find((x) => x.id === n.id);
            linkOwnNote(n.id, g.id, { local: now ? fingerprint(local(now), label) : mine, google: theirs });
            r.pulled++;
          }
        }
      }
    } catch (e) {
      fail(name, e);
    }
    tick(name);
  }

  // 4. Keep's notes with the board's label → into the board.
  for (const g of toImport) {
    const name = g.title || g.text.split("\n")[0].slice(0, 40) || "note";
    try {
      const id = importOwnNote(boardId, { ...google(g), labels: withoutLabel(g.labels, label) }, g.id);
      const now = boardNotesForSync(boardId).find((x) => x.id === id);
      if (now) linkOwnNote(id, g.id, { local: fingerprint(local(now), label), google: fingerprint(google(g), label) });
      r.imported++;
    } catch (e) {
      fail(name, e);
    }
    tick(name);
  }
  state.step = "done";
}
