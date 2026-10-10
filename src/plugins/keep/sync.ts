import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { automationCdp, automationEnv, driverPath } from "@/plugins/drivers";
import { keepSettings, saveKeepNotes, type KeepNote } from "./store";

/** One Keep sync at a time across the whole server (actions and the scheduler are separate module copies). */
const flag = globalThis as { __zeffKeepSyncing?: boolean };

/** Whether the automation Chrome runs — the background sync never starts it. */
async function chromeUp(): Promise<boolean> {
  return fetch(`${automationCdp("keep")}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * Read your Google Keep notes (Google Keep plugin) in the account's automation Chrome — Keep opened
 * in a fresh tab, what its app loads kept, the tab closed again; nothing in Keep changes — and keep
 * them. `background`: only while Chrome runs; by hand it may start it. "N new · M changed · K in all".
 */
export async function syncKeep({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (flag.__zeffKeepSyncing) return { ok: false, message: "A Keep sync is already running." };
  flag.__zeffKeepSyncing = true;
  try {
    if (background && !(await chromeUp())) return { ok: false, message: "The automation Chrome isn't running. Not synced." };
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("keep")], env: automationEnv(), label: "Keep sync" },
      async (call) => resultToPayload(await call("keep_notes", { account: keepSettings().account, launch: !background })),
      240000,
    );
    const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { notes?: KeepNote[]; full?: boolean } | null;
    if (!data || !Array.isArray(data.notes)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : "Keep returned nothing readable.");
    const r = saveKeepNotes(data.notes, !!data.full);
    clearAttention("login:keep");
    return { ok: true, message: `${r.added} new · ${r.changed} changed${r.removed ? ` · ${r.removed} removed` : ""} · ${r.total} in all` };
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    if (needsSignIn(message) || /sign[- ]in|anmeld/i.test(message)) raiseLogin("keep", message);
    return { ok: false, message };
  } finally {
    flag.__zeffKeepSyncing = false;
  }
}
