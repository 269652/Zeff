"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** Settings → Badges: the Workspace tree's badges — which kinds, their colours, which sources count. Saved as you change them. */
export async function saveWorkspaceBadgesAction(config: unknown): Promise<ActionState> {
  try {
    (await import("@/plugins/workspace/badge-config-store")).setWsBadges(config);
    // Counted anew at the next reading (a source switched off is gone at once, not after the badges' next minute).
    (await import("@/plugins/workspace/badges")).forgetPageBadges();
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Settings → Badges: the small marks (the Todos page's unseen activity, the header's dots) — on or off, their colours. `look`: the marks of one section; the others stay as they are. */
export async function saveBadgeLookAction(look: unknown): Promise<ActionState> {
  try {
    const store = await import("@/lib/badges/look-store");
    store.setBadgeLook({ ...store.getBadgeLook(), ...(look && typeof look === "object" && !Array.isArray(look) ? look : {}) });
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
