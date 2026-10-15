"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { GUARDABLE, type TouchAction } from "@/lib/touch/actions";

/** Settings → Touch to approve. Each takes the touch the browser asked for just before (once a key is registered). */

/** Switch the guarded actions (the list of actions that wait for a touch). */
export async function setTouchGuardAction(actions: string[]): Promise<ActionState> {
  try {
    const { setGuarded } = await import("@/lib/touch");
    setGuarded(actions.filter((a): a is TouchAction => (GUARDABLE as readonly string[]).includes(a)));
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Forget a registered key. */
export async function removeTouchKeyAction(id: string): Promise<ActionState> {
  try {
    const { removeCredential } = await import("@/lib/touch");
    removeCredential(String(id));
    revalidateAll();
    return { ok: true, message: t("Key removed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
