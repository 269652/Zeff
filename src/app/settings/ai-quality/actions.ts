"use server";

import { revalidateAll } from "@/app/action-helpers";

/** The AI quality page's server actions (forms). */

/** Your word on a learned rule: confirmed (the step applies it), dismissed (not proposed again) — or a confirmed one taken back. */
export async function decideRuleAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  const status = fd.get("status") === "confirmed" ? "confirmed" : "dismissed";
  if (!Number.isInteger(id)) return;
  const { decideRule } = await import("@/lib/learning/rules");
  decideRule(id, status);
  revalidateAll();
}

/** The past decisions read again from the places that keep them (idempotent — nothing doubles). */
export async function backfillAction(): Promise<void> {
  const { ensureBackfilled } = await import("@/lib/learning");
  ensureBackfilled(true);
  revalidateAll();
}
