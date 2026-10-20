"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";

/** A button pressed (or y / n) on an item of the review queue: done by the plugin it came from. */
export async function reviewActAction(key: string, action: string): Promise<ActionState> {
  try {
    const { reviewAct } = await import("@/lib/review");
    const r = await reviewAct(String(key ?? ""), String(action ?? ""));
    revalidateAll();
    return { ok: true, message: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
