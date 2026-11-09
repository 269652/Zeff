"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** About you, saved (one record — lib/about-me.ts): every place that shows it, and every AI prompt from now on. */
export async function saveAboutMeAction(text: string): Promise<ActionState> {
  try {
    await (await import("@/lib/about-me")).setAboutMe(String(text ?? ""));
    revalidatePath("/settings/about");
    revalidatePath("/settings/ai");
    return { ok: true, message: t("Saved — the AI knows it from the next task on.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
