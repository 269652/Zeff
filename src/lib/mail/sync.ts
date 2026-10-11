import { automationCdp, automationEnv, driverPath } from "@/plugins/drivers";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { getMailSettings, saveMails, updateMailSettings, type MailInput } from "./store";

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
  return fetch(`${automationCdp("outlook")}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
}

type Source = "outlook" | "gmail" | "whatsapp" | "signal";
const SOURCE_LABELS: Record<Source, string> = { outlook: "Outlook", gmail: "Gmail", whatsapp: "WhatsApp", signal: "Signal" };
const SOURCE_PLUGINS = { outlook: "outlook-mail", gmail: "gmail", whatsapp: "whatsapp" } as const;

/** WhatsApp: the active chats' messages — else (WhatsApp Web doesn't offer them) each chat's last one from the list. */
async function whatsappRead(call: (name: string, args: Record<string, unknown>) => Promise<unknown>, days: number, background: boolean): Promise<unknown> {
  const { resultToPayload } = await import("@/lib/jira/mcp-client");
  const r = await call("whatsapp_messages", { days, maxLoads: days > DAYS ? 8 : 3, openIfMissing: true, launch: !background });
  const p = resultToPayload(r);
  const data = typeof p === "string" ? (p.trim().startsWith("{") ? JSON.parse(p) : null) : p;
  if (data && Array.isArray((data as { messages?: unknown }).messages)) return r;
  return call("whatsapp_chats", { days, maxChats: days > DAYS ? 300 : 100, openIfMissing: true, launch: !background });
}

/** One source read (Outlook's or Gmail's list, WhatsApp's chat list) — as shown: no mail or chat opened, none marked read. */
async function readMailbox(source: Source, days: number, background: boolean, gmail?: { account: string; folder: string }): Promise<{ messages: MailInput[]; missing?: string[] }> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const out = await runStdioSession(
    { command: process.execPath, args: [driverPath(source)], env: automationEnv(), label: `${SOURCE_LABELS[source]} sync` },
    async (call) =>
      resultToPayload(
        source === "gmail"
          ? await call("gmail_mail", {
              days,
              maxPages: days > DAYS ? 20 : 3,
              account: gmail?.account ?? "0",
              folder: gmail?.folder ?? "Gmail",
              openIfMissing: true,
              launch: !background,
              // Every conversation you wrote in, whole — the messages' full text read once.
              conversations: true,
              fullKnown: getPref<string[]>(`gmail:full:${gmail?.account ?? "0"}`, []),
            })
          : source === "whatsapp"
            ? await whatsappRead(call, days, background)
            : source === "signal"
              ? await call("signal_messages", { days, maxLoads: days > DAYS ? 8 : 3, launch: !background })
              : await call("outlook_mail", { days, folders: getMailSettings().folders, openIfMissing: true, launch: !background }),
      ),
    600000, // two months of the list: scrolled (paged) through, row by row
  );
  const data = (typeof out === "string" ? JSON.parse(out) : out) as { messages?: MailInput[]; missing?: string[] };
  if (!Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("{source} returned nothing readable.", { source: SOURCE_LABELS[source] }));
  return { messages: data.messages, missing: data.missing };
}

/** One source read and kept — "N new · M in all", or why not (a sign-in it wants: asked of you, never done by Zeff). */
async function syncSource(source: Source, days: number, background: boolean, prefix: boolean, gmail?: { account: string; folder: string }): Promise<{ ok: boolean; part: string }> {
  const label = gmail?.folder ?? SOURCE_LABELS[source];
  try {
    const r = await readMailbox(source, days, background, gmail);
    const { added, total } = saveMails(r.messages);
    if (source === "gmail") {
      const k = `gmail:full:${gmail?.account ?? "0"}`;
      const full = r.messages.filter((m) => m.full && m.id).map((m) => m.id!);
      if (full.length) setPref(k, [...new Set([...getPref<string[]>(k, []), ...full])].slice(-5000));
    }
    clearAttention(`login:${source}`);
    const counted = t("{added} new · {total} in all", { added, total });
    const missing = r.missing?.length ? ` — ${t("not found in Outlook: {folders}", { folders: r.missing.join(", ") })}` : "";
    return { ok: true, part: `${prefix ? `${label}: ` : ""}${counted}${missing}` };
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    if (needsSignIn(message) || /sign[- ]in|anmeld|verknüpf/i.test(message)) raiseLogin(source, message);
    return { ok: false, part: `${label}: ${message}` };
  }
}

/**
 * Read your inbox's latest mails — from Outlook (Outlook Mail plugin) and/or Gmail (Gmail plugin) in
 * the account's automation Chrome — and keep them. `background`: only while Chrome runs; by hand it
 * may start it. A mailbox that fails doesn't stop the other.
 */
export async function syncMail({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (state.__zeffMailSyncing) return { ok: false, message: t("A mail sync is already running.") };
  state.__zeffMailSyncing = true;
  try {
    // In the background without the automation Chrome: later, as for the other sources — not a failure
    // (that would also make the next sync read two months again).
    if (background && !(await chromeUp())) return { ok: true, message: t("The automation Chrome isn't running — later.") };
    const { isInstalled } = await import("@/plugins/state");
    const sources = (["outlook", "gmail"] as const).filter((s) => isInstalled(SOURCE_PLUGINS[s]));
    if (!sources.length) return record(false, t("No mail plugin installed (Outlook Mail or Gmail)."));
    const days = background && getMailSettings().lastOk ? DAYS : FULL_DAYS;
    const done = [];
    // Gmail: each account set on its settings page, into its own folder.
    const { gmailAccounts, gmailFolder } = await import("@/plugins/gmail/accounts");
    const boxes = sources.flatMap((source): { source: Source; gmail?: { account: string; folder: string } }[] => (source === "gmail" ? gmailAccounts().map((a, i) => ({ source, gmail: { account: a.account, folder: gmailFolder(a, i) } })) : [{ source, gmail: undefined }]));
    for (const b of boxes) done.push(await syncSource(b.source, days, background, boxes.length > 1, b.gmail));
    return record(done.some((d) => d.ok), done.map((d) => d.part).join(" · "));
  } finally {
    state.__zeffMailSyncing = false;
  }
}

/**
 * Read your WhatsApp chats' latest messages (WhatsApp plugin) from WhatsApp Web's chat list in the
 * automation Chrome — no chat opened — and keep them with the mails (folder "WhatsApp"), for the
 * Durchsicht, the Zuordnung and the knowledge. Its own step (the Sync menu records how it went).
 * The first time two months, then the last days.
 */
export async function syncWhatsapp({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  const flag = globalThis as { __zeffWhatsappSyncing?: boolean };
  if (flag.__zeffWhatsappSyncing) return { ok: false, message: t("A WhatsApp sync is already running.") };
  flag.__zeffWhatsappSyncing = true;
  try {
    if (background && !(await chromeUp())) return { ok: false, message: "The automation Chrome isn't running. Not synced." };
    // The first time (the messages read — not only the chat list's last ones): the whole window.
    const { getPref, setPref } = await import("@/lib/prefs");
    const known = getPref("whatsapp:messages-read", false) && (getDb().select({ n: sql<number>`count(*)` }).from(schema.emails).where(sql`${schema.emails.folder} = 'WhatsApp'`).get()?.n ?? 0) > 0;
    const r = await syncSource("whatsapp", known ? DAYS : FULL_DAYS, background, false);
    if (r.ok) setPref("whatsapp:messages-read", true);
    return { ok: r.ok, message: r.part };
  } finally {
    flag.__zeffWhatsappSyncing = false;
  }
}

/**
 * Read your Signal chats' messages (Signal plugin) from Signal Desktop over its debug port — no chat
 * opened, nothing marked read — and keep them with the mails (folder "Signal"), for the Durchsicht,
 * the Zuordnung and the knowledge. Signal is started (in the tray, with the port) if it isn't running
 * — the scheduler only runs it while Signal runs. The first time two months, then the last days.
 */
export async function syncSignal(): Promise<{ ok: boolean; message: string }> {
  const flag = globalThis as { __zeffSignalSyncing?: boolean };
  if (flag.__zeffSignalSyncing) return { ok: false, message: t("A Signal sync is already running.") };
  flag.__zeffSignalSyncing = true;
  try {
    const known = (getDb().select({ n: sql<number>`count(*)` }).from(schema.emails).where(sql`${schema.emails.folder} = 'Signal'`).get()?.n ?? 0) > 0;
    const r = await syncSource("signal", known ? DAYS : FULL_DAYS, false, false);
    return { ok: r.ok, message: r.part };
  } finally {
    flag.__zeffSignalSyncing = false;
  }
}
