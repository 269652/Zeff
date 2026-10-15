"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * Parallel work under a collecting entry (a mob day): an entry joins it or leaves it again. Nothing
 * is moved or rewritten — the entry keeps its real hours, start, words and evidence; only what it books changes.
 * Each answers an ActionState.
 */

/** An entry joins the day's collecting entry (the switch "Group entry", or dropped onto it). */
export async function linkEntryAction(entryId: number, spanId: string): Promise<ActionState> {
  try {
    const { linkMember, entryRow } = await import("@/lib/entry-spans");
    linkMember(Number(entryId), String(spanId));
    revalidateAll();
    return { ok: true, message: t("Grouped: {what}", { what: (entryRow(Number(entryId))?.description ?? "").slice(0, 80) }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An entry leaves its group and books what it worked, on its own (the switch "Separate entry"). */
export async function unlinkEntryAction(entryId: number): Promise<ActionState> {
  try {
    const { unlinkMember } = await import("@/lib/entry-spans");
    unlinkMember(Number(entryId));
    revalidateAll();
    return { ok: true, message: t("Now a separate entry again — it books what it worked.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** All the day's entries that run parallel to the collecting entry are grouped under it. */
export async function collectIntoHeadAction(headId: number): Promise<ActionState> {
  try {
    const { collectIntoHead } = await import("@/lib/entry-parallel");
    const n = collectIntoHead(Number(headId));
    revalidateAll();
    return { ok: true, message: n === 0 ? t("Nothing to collect — no parallel entries that day.") : n === 1 ? t("1 entry grouped under it.") : t("{n} entries grouped under it.", { n }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An entry's start time ("HH:MM"; empty: none) — what makes work parallel to other work. Parallel work is grouped by it when it is set. */
export async function setEntryStartAction(entryId: number, start: string): Promise<ActionState> {
  try {
    const { normalizeStart } = await import("@/lib/entry-timeline");
    const text = String(start ?? "").trim();
    const value = normalizeStart(text);
    if (text && !value) return { ok: false, error: t("A time like 09:30.") };
    const { getEntry, updateEntry } = await import("@/lib/entries");
    const before = getEntry(Number(entryId));
    if (!before) return { ok: false, error: t("Time entry #{id} not found.", { id: Number(entryId) }) };
    updateEntry(before.id, { start: value });
    // Set on an entry that is not grouped yet: it may now run parallel to something.
    let grouped = "";
    if (value && !before.spanId && !before.isGroup) {
      const { autoGroup, parallelSaid } = await import("@/lib/entry-parallel");
      const g = autoGroup(before.id);
      if (g) grouped = ` ${parallelSaid(g)}`;
    }
    revalidateAll();
    return { ok: true, message: `${value ? t("Start {time}.", { time: value }) : t("Start removed.")}${grouped}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
