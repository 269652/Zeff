import path from "node:path";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { getMailSettings, saveMails, updateMailSettings, type MailInput } from "./store";

const CDP = process.env.OUTLOOK_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
/** How far back a sync reads: in the background the last days; by hand (and the first time) two months. */
const DAYS = 3;
const FULL_DAYS = 60;

/** One sync at a time across the whole server (actions and the scheduler are separate module copies). */
const state = globalThis as { __zeffMailSyncing?: boolean };

function record(ok: boolean, message: string): { ok: boolean; message: string } {
  updateMailSettings({ lastSyncAt: new Date().toISOString(), lastResult: message, lastOk: ok });
  return { ok, message };
}

/** Whether the automation Chrome runs — the background sync never starts it (it opens a mail tab there, though). */
async function chromeUp(): Promise<boolean> {
  return fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * Read your inbox's latest mails from Outlook in the automation Chrome (scripts/outlook-mcp.mjs —
 * the mail list as shown: no mail opened, none marked read) and keep them. `background`: only
 * while Chrome runs; by hand it may start it.
 */
export async function syncMail({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (state.__zeffMailSyncing) return { ok: false, message: "A mail sync is already running." };
  state.__zeffMailSyncing = true;
  try {
    if (background && !(await chromeUp())) return record(false, "The automation Chrome isn't running. Not synced.");
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "outlook-mcp.mjs");
    const days = background && getMailSettings().lastOk ? DAYS : FULL_DAYS;
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: {}, label: "Mail sync" },
      async (call) => resultToPayload(await call("outlook_mail", { days, folders: getMailSettings().folders, openIfMissing: true, launch: !background })),
      600000, // two months of the list: scrolled through, row by row
    );
    const data = (typeof out === "string" ? JSON.parse(out) : out) as { messages?: MailInput[]; missing?: string[] };
    if (!Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.slice(0, 300) : "Outlook returned nothing readable.");
    const { added, total } = saveMails(data.messages);
    clearAttention("login:outlook");
    return record(true, `${added} new · ${total} in all${data.missing?.length ? ` — not found in Outlook: ${data.missing.join(", ")}` : ""}`);
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    // Outlook wants you to sign in: asked of you (and pinged) — never done by Zeff.
    if (needsSignIn(message)) raiseLogin("outlook", message);
    return record(false, message);
  } finally {
    state.__zeffMailSyncing = false;
  }
}
