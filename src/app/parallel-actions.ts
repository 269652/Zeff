"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * Parallel work (tasks done at the same time): the ways to BOOK it — each answers an ActionState.
 * Switching a way only changes the hours the entries book; the tasks, their real hours and starts,
 * words and evidence stay as they are.
 */

const MODES = ["combine", "divide", "sequential"] as const;
type Mode = (typeof MODES)[number];
const isMode = (m: string): m is Mode => (MODES as readonly string[]).includes(m);

/** Detected parallel work grouped, booked the way chosen. */
export async function applyParallelAction(ids: number[], mode: string): Promise<ActionState> {
  try {
    if (!isMode(mode)) return { ok: false, error: t("Unknown way of booking.") };
    const { applyParallel } = await import("@/lib/entry-parallel");
    const r = applyParallel((Array.isArray(ids) ? ids : []).map(Number), mode);
    revalidateAll();
    return { ok: true, message: r.mode === "combine" ? t("Combined into one spanning entry.") : r.mode === "divide" ? t("The stretch's hours are divided between the entries.") : t("Booked one after the other.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A group booked another way: all on the group, the time divided, sequential, sequential with the remainder on the group. */
export async function setSpanModeAction(spanId: string, mode: string): Promise<ActionState> {
  try {
    const { SPAN_MODES, setSpanMode } = await import("@/lib/entry-spans");
    if (!(SPAN_MODES as string[]).includes(mode)) return { ok: false, error: t("Unknown way of booking.") };
    setSpanMode(String(spanId), mode as (typeof SPAN_MODES)[number]);
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A group taken apart: every task books what it worked again; a spanning entry Zeff made goes, one of yours stays. */
export async function ungroupSpanAction(spanId: string): Promise<ActionState> {
  try {
    const { dissolveSpan } = await import("@/lib/entry-spans");
    dissolveSpan(String(spanId));
    revalidateAll();
    return { ok: true, message: t("Ungrouped — every entry books what it worked.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** How parallel work is booked by default, when it is noticed as it is booked. */
export async function setDefaultParallelModeAction(mode: string): Promise<ActionState> {
  try {
    if (!isMode(mode)) return { ok: false, error: t("Unknown way of booking.") };
    const { setDefaultParallelMode } = await import("@/lib/entry-parallel");
    setDefaultParallelMode(mode);
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
