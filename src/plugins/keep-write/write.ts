import { needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { automationEnv, driverPath } from "@/plugins/drivers";
import { getKeepNote, keepSettings, removeKeepNote, saveKeepNotes, type KeepNote } from "@/plugins/keep/store";

/**
 * Writing to Google Keep (Google Keep schreiben, beta): the Keep driver's keep_write — Keep's own
 * editor in a fresh tab of the account's automation Chrome, driven like by hand — and what Keep
 * confirmed kept in Zeff's copy of your notes. Runs only on a click (the Google-Keep view).
 */

/** A note as Zeff writes it: a checklist as "- [ ] …" / "- [x] …" lines in `text`. */
export type KeepWrite = { title?: string; text?: string; color?: string | null; labels?: string[]; pinned?: boolean; archived?: boolean };

/** All lines checklist lines (and at least one): a Keep list. */
export const isChecklist = (text: string) => {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => /^\s*[-*]\s\[( |x|X)\]/.test(l));
};

type Answer = { ok: boolean; confirmed: boolean; trashed?: boolean; note?: KeepNote | null };

async function keepWrite(args: Record<string, unknown>): Promise<Answer> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  let out: unknown;
  try {
    out = await runStdioSession(
      { command: process.execPath, args: [driverPath("keep")], env: automationEnv(), label: "Keep schreiben" },
      async (call) => resultToPayload(await call("keep_write", { account: keepSettings().account, ...args })),
      240000,
    );
  } catch (e) {
    const message = errorMessage(e);
    if (needsSignIn(message) || /sign[- ]in|anmeld/i.test(message)) raiseLogin("keep", message);
    throw e;
  }
  const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as Answer | null;
  if (!data || typeof data.confirmed !== "boolean") throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : "Keep hat nichts Lesbares geantwortet.");
  return data;
}

/** What Keep has now, into Zeff's copy. */
function keep(note: KeepNote | null | undefined): KeepNote | null {
  if (!note?.id) return null;
  saveKeepNotes([note], false);
  return getKeepNote(note.id);
}

const unconfirmed = "Keep hat die Änderung nicht bestätigt — in Keep nachsehen (und Keep syncen).";

/** A new note in Google Keep. */
export async function createGoogleNote(v: KeepWrite): Promise<KeepNote> {
  const text = v.text ?? "";
  const r = await keepWrite({ op: "create", title: v.title ?? "", text, list: isChecklist(text), color: v.color ?? undefined, labels: v.labels ?? [], pinned: v.pinned, archived: v.archived });
  const note = keep(r.note);
  if (!r.confirmed || !note) throw new Error(unconfirmed);
  return note;
}

/** A Google-Keep note changed — only the fields given. */
export async function updateGoogleNote(id: string, patch: KeepWrite): Promise<KeepNote> {
  const current = getKeepNote(id);
  if (!current) throw new Error("Diese Notiz kennt Zeff nicht (mehr) — Keep syncen.");
  const text = patch.text;
  const r = await keepWrite({
    op: "update",
    id,
    kind: current.kind,
    title: patch.title,
    text,
    list: text === undefined ? undefined : isChecklist(text),
    color: patch.color === undefined ? undefined : (patch.color ?? "default"),
    labels: patch.labels,
    pinned: patch.pinned,
    archived: patch.archived,
    current,
  });
  const note = keep(r.note);
  if (!r.confirmed || !note) throw new Error(unconfirmed);
  return note;
}

/** A Google-Keep note into Keep's trash (and out of Zeff's copy). */
export async function trashGoogleNote(id: string): Promise<void> {
  const current = getKeepNote(id);
  if (!current) throw new Error("Diese Notiz kennt Zeff nicht (mehr) — Keep syncen.");
  const r = await keepWrite({ op: "trash", id, kind: current.kind, current });
  if (!r.confirmed) throw new Error(unconfirmed);
  removeKeepNote(id);
}
