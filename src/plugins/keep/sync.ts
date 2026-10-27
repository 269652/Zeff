import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { automationEnv, automationUp, driverPath } from "@/plugins/drivers";
import { keepSettings, saveKeepNotes, type KeepNote } from "./store";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";

/** One Keep sync at a time across the whole server (actions and the scheduler are separate module copies). */

/** Whether the automation Chrome runs — the background sync never starts it. */
async function chromeUp(): Promise<boolean> {
  return automationUp("keep");
}

/**
 * Read your Google Keep notes (Google Keep plugin) in the account's automation Chrome — Keep opened
 * in a fresh tab, what its app loads kept, the tab closed again; nothing in Keep changes — and keep
 * them. `background`: only while Chrome runs; by hand it may start it. "N new · M changed · K in all".
 */
export async function syncKeep({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (accountFlag("__zeffKeepSyncing")) return { ok: false, message: t("A Keep sync is already running.") };
  setAccountFlag("__zeffKeepSyncing", true);
  try {
    if (background && !(await chromeUp())) return { ok: false, message: t("The automation Chrome isn't running. Not synced.") };
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("keep")], env: automationEnv(), label: "Keep sync" },
      async (call) => resultToPayload(await call("keep_notes", { account: keepSettings().account, launch: !background })),
      240000,
    );
    const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { notes?: KeepNote[]; full?: boolean } | null;
    if (!data || !Array.isArray(data.notes)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : t("Keep returned nothing readable."));
    const r = saveKeepNotes(data.notes, !!data.full);
    clearAttention("login:keep");
    // Google Keep's database in the Workspace (Google Keep as a data source) follows at once.
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("workspace")) {
      (await import("./google-workspace")).syncGoogleKeepDatabase();
      await (await import("@/plugins/workspace/pipeline")).runPipelinesAfterSync().catch((e) => console.error("[workspace] the pipelines failed", e));
    }
    return {
      ok: true,
      message: [t("{n} new", { n: r.added }), t("{n} changed", { n: r.changed }), ...(r.removed ? [t("{n} removed", { n: r.removed })] : []), t("{n} in all", { n: r.total })].join(" · "),
    };
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    if (needsSignIn(message) || /sign[- ]in|anmeld/i.test(message)) raiseLogin("keep", message);
    return { ok: false, message };
  } finally {
    setAccountFlag("__zeffKeepSyncing", false);
  }
}
