"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/** A Jira board's "Auswerten": the Board-Lage — the relevant tickets you're in, or all — in the background. */
export async function startBoardLageAction(opts: { all?: boolean } = {}): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    if (!isInstalled("jira-lage")) return { ok: false, error: t("Jira briefing is not installed (Menu → Plugins).") };
    // The tickets you're in — or (on request) all, also those without you.
    (await import("./board-lage")).setBoardLageScope(!!opts.all);
    const r = (await import("@/lib/sync/registry")).startSync("boardlage");
    revalidatePath("/kanban", "layout");
    return r.ok ? { ok: true, message: t("The board briefing is running — the cards fill in as parts are done.") } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
