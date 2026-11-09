"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** Settings → Mobile access: Zeff served in your tailnet or not, and the password the phone signs in with. */

export async function setMobileAccessAction(on: boolean): Promise<ActionState> {
  try {
    const { readGate } = await import("@/lib/gate");
    // (On without a password, the phone would only find a closed door: the password first.)
    if (on && !readGate()) return { ok: false, error: t("Set a password first — the phone signs in with it.") };
    const { setTailscaleServe } = await import("@/lib/tailscale");
    const s = await setTailscaleServe(!!on);
    revalidatePath("/settings/mobile");
    return { ok: true, message: on ? (s.url ? t("Zeff is reachable in your tailnet: {url}", { url: s.url }) : t("Turned on.")) : t("Zeff is no longer reachable in your tailnet.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setMobilePasswordAction(password: string): Promise<ActionState> {
  try {
    if (typeof password !== "string" || password.length < 12) return { ok: false, error: t("At least 12 characters.") };
    (await import("@/lib/gate")).setGatePassword(password);
    revalidatePath("/settings/mobile");
    return { ok: true, message: t("Password set — the phones signed in before have to sign in again.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The phone's conflicts looked at: the list emptied (src/lib/replica/server.ts). */
export async function clearPhoneConflictsAction(): Promise<ActionState> {
  try {
    (await import("@/lib/replica/server")).clearReplicaConflicts();
    revalidatePath("/settings/mobile");
    return { ok: true, message: t("Cleared.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
