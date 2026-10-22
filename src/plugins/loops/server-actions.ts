"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { Loop, LoopView } from "./shared";
import type { LoopOp } from "./store";

/** The Open loops plugin's server actions: the loops of a view (or of a person, of a Workspace row that is one), your word on one. */

export type ShownLoop = Loop & { personHref: string };
export type LoopsAnswer = { ok: true; loops: ShownLoop[]; counts: { mine: number; theirs: number; overdue: number } } | { ok: false; error: string; off?: boolean };

const off = () => (isInstalled("loops") ? null : t("The Open loops plugin is not installed (Menu → Plugins)."));

async function hrefs(): Promise<(id: number | null) => string> {
  if (!isInstalled("workspace")) return () => "";
  const { personHrefs } = await import("@/plugins/workspace/people-database");
  const all = personHrefs();
  return (id) => (id ? (all[id] ?? "") : "");
}

/** A Workspace row's person (a person's own page is a row of the people database). */
async function personOfRow(row: number): Promise<number | null> {
  const { refsOfRow } = await import("@/plugins/timeline/refs");
  const ref = refsOfRow(row).find((r) => r.startsWith("person:"));
  return ref ? Number(ref.slice("person:".length)) : null;
}

export async function loopsAction(q: { view?: LoopView; personId?: number; row?: number }): Promise<LoopsAnswer> {
  try {
    const no = off();
    if (no) return { ok: false, error: no, off: true };
    const { listLoops } = await import("./query");
    let personId = q.personId ? Number(q.personId) : undefined;
    if (q.row) {
      const p = await personOfRow(Number(q.row));
      if (!p) return { ok: true, loops: [], counts: { mine: 0, theirs: 0, overdue: 0 } };
      personId = p;
    }
    const open = listLoops({ personId });
    const loops = q.view === "closed" ? listLoops({ view: "closed", personId }) : q.view === "mine" || q.view === "theirs" ? open.filter((l) => l.direction === q.view) : q.view === "overdue" ? open.filter((l) => l.overdue) : open;
    const href = await hrefs();
    return {
      ok: true,
      loops: loops.slice(0, 300).map((l) => ({ ...l, personHref: href(l.personId) })),
      counts: { mine: open.filter((l) => l.direction === "mine").length, theirs: open.filter((l) => l.direction === "theirs").length, overdue: open.filter((l) => l.overdue).length },
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Your word on a loop: close, dismiss (not a loop), confirm, reopen, accept-close / reject-close (a proposal), later. */
export async function decideLoopAction(ref: string, op: LoopOp): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const no = off();
    if (no) return { ok: false, error: no };
    const { decideLoop } = await import("./store");
    const r = decideLoop(String(ref).slice(0, 400), op);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The open loops of messages (their source refs: "mail:<key>", "teams:<key>" …) — the chips in the inbox and the chats. */
export async function loopsOfMessagesAction(sourceRefs: string[]): Promise<Record<string, { direction: Loop["direction"]; kind: Loop["kind"]; text: string; overdue: boolean }[]>> {
  try {
    if (off() || !sourceRefs.length) return {};
    const want = new Set(sourceRefs.slice(0, 500).map(String));
    const { listLoops } = await import("./query");
    const out: Record<string, { direction: Loop["direction"]; kind: Loop["kind"]; text: string; overdue: boolean }[]> = {};
    for (const l of listLoops({})) if (want.has(l.sourceRef)) (out[l.sourceRef] ??= []).push({ direction: l.direction, kind: l.kind, text: l.text, overdue: l.overdue });
    return out;
  } catch {
    return {};
  }
}

/** A form's word on a loop (the Today page's nudges): `ref`, `op` (later, close), back to `to`. */
export async function loopFormAction(fd: FormData): Promise<void> {
  const { revalidatePath } = await import("next/cache");
  const { redirect } = await import("next/navigation");
  const op = String(fd.get("op") ?? "");
  if (!off() && (op === "later" || op === "close")) (await import("./store")).decideLoop(String(fd.get("ref") ?? "").slice(0, 400), op);
  revalidatePath("/heute");
  redirect(String(fd.get("to") ?? "") || "/heute");
}
