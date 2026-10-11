/**
 * Mail attachments → Documents, the step after a mail sync (and the “Fetch attachments now” button):
 * the mails the list flagged with attachments (last N days, sources, folders and senders as set)
 * get their attachments fetched through the driver one mail at a time, the files that pass the rules
 * become documents (the Documents plugin reads and compiles them), and every attachment seen is
 * noted in `mail_attachments` so a sync never fetches the same one twice. A failure here is a
 * message, never a failed mail sync. Server only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentAccountId } from "@/db/accounts";
import { automationEnv, driverPath } from "@/plugins/drivers";
import { throwIfAborted } from "@/lib/abort";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { attachmentKey, decideAttachment, documentName, mayOpenMail, maxBytesOf, SOURCE_QUIET, type AttachmentSettings, type AttachmentSource } from "./attachment-rules";
import { attachmentCandidates, attachmentRows, attachmentSettings, MAX_TRIES, noteAttachment, type MailCandidate } from "./attachments-store";

/** At most this many mails (opened, or fetched) and this long per run — the rest next time. */
export const AUTO_LIMITS = { mails: 15, ms: 4 * 60000 };
export const MANUAL_LIMITS = { mails: 40, ms: 10 * 60000 };

const SOURCE_PLUGINS: Record<AttachmentSource, "outlook-mail" | "gmail"> = { outlook: "outlook-mail", gmail: "gmail" };
const SOURCE_LABELS: Record<AttachmentSource, string> = { outlook: "Outlook", gmail: "Gmail" };

/** The sources whose plugin is installed in this account. */
export const installedAttachmentSources = (): AttachmentSource[] => (["outlook", "gmail"] as const).filter((s) => isInstalled(SOURCE_PLUGINS[s]));

/** A driver call: tool name and arguments → its JSON answer. */
export type DriverCall = (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
/** Runs `body` with a driver session for a source (one process for the whole run). Replaceable for tests. */
export type SessionOpener = <T>(source: AttachmentSource, body: (call: DriverCall) => Promise<T>, timeoutMs: number) => Promise<T>;

const defaultOpener: SessionOpener = async (source, body, timeoutMs) => {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  return runStdioSession(
    { command: process.execPath, args: [driverPath(source)], env: automationEnv(), label: `${SOURCE_LABELS[source]} attachments` },
    async (call) =>
      body(async (tool, args) => {
        const p = resultToPayload(await call(tool, args));
        const data = typeof p === "string" ? JSON.parse(p) : p;
        if (!data || typeof data !== "object") throw new Error(String(p).slice(0, 200));
        return data as Record<string, unknown>;
      }),
    timeoutMs,
  );
};

let opener: SessionOpener = defaultOpener;
/** Tests: talk to a stand-in instead of the real driver (null: the real one again). */
export const setAttachmentSessionOpener = (o: SessionOpener | null) => {
  opener = o ?? defaultOpener;
};

export type AttachmentRun = {
  ran: boolean;
  /** Documents made (a repeat of a file already in the store doesn't count). */
  documents: number;
  /** Attachments that were new to the bookkeeping. */
  seen: number;
  mails: number;
  unreadLeft: number;
  failed: number;
  /** Mails left for the next run (the limits). */
  more: number;
  /** Mails opened in the web app that were unread, and how many of those were marked unread again. */
  openedUnread: number;
  restored: number;
  /** One line for the sync's message — empty when there is nothing to say. */
  message: string;
  /** Why it stopped early, if it did. */
  error?: string;
};

const none = (patch: Partial<AttachmentRun> = {}): AttachmentRun => ({ ran: false, documents: 0, seen: 0, mails: 0, unreadLeft: 0, failed: 0, more: 0, openedUnread: 0, restored: 0, message: "", ...patch });

type ListedAttachment = { id: string; name: string; mime: string; size: number; inline: boolean };

/** One mail: list its attachments, apply the rules, fetch what passes, make documents. Counts into `run`. */
async function processMail(call: DriverCall, mail: MailCandidate, s: AttachmentSettings, tmp: string, run: AttachmentRun): Promise<void> {
  const prefix = mail.source;
  const restoreUnread = !SOURCE_QUIET[mail.source] && s.unread === "include";
  const base = { ref: mail.ref, ...(mail.source === "gmail" ? { account: mail.account ?? "0" } : {}), wasUnread: mail.unread, restoreUnread };
  const listed = await call(`${prefix}_attachments`, base);
  if (listed.opened && mail.unread) run.openedUnread++;
  if (listed.restoredUnread) run.restored++;
  const attachments = (Array.isArray(listed.attachments) ? listed.attachments : []) as ListedAttachment[];
  const rows = new Map(attachmentRows(mail.source, mail.key).map((r) => [r.attKey, r]));
  const take: ListedAttachment[] = [];
  for (const a of attachments) {
    const key = attachmentKey(a);
    const had = rows.get(key);
    if (had && (had.status === "done" || (had.status === "failed" && had.tries >= MAX_TRIES))) continue;
    const d = decideAttachment(a, s);
    if (!d.take) {
      if (!had || had.status !== "skipped" || had.error !== d.why) run.seen++;
      noteAttachment({ source: mail.source, mailKey: mail.key, attKey: key, name: a.name, mime: a.mime, size: a.size, status: "skipped", error: d.why });
      continue;
    }
    take.push(a);
  }
  // A flagged mail with nothing in it to take is noted too (not opened again).
  if (!attachments.length) noteAttachment({ source: mail.source, mailKey: mail.key, attKey: "", status: "none" });
  // A retry of a failed list call is over once it answered.
  else if (rows.has("")) noteAttachment({ source: mail.source, mailKey: mail.key, attKey: "", status: "none" });
  if (!take.length) return;

  const dir = fs.mkdtempSync(path.join(tmp, "m-"));
  try {
    const got = await call(`${prefix}_download`, { ...base, ids: take.map((a) => a.id), dir, maxBytes: maxBytesOf(s) });
    if (got.restoredUnread) run.restored++;
    const files = (Array.isArray(got.files) ? got.files : []) as { id: string; name: string; mime?: string; size?: number; path: string }[];
    const { addDocument } = await import("@/plugins/documents/store");
    for (const a of take) {
      const key = attachmentKey(a);
      const f = files.find((x) => x.id === a.id);
      const meta = { source: mail.source, mailKey: mail.key, attKey: key, name: a.name, mime: a.mime, size: a.size };
      if (!f) {
        const why = (Array.isArray(got.skipped) ? (got.skipped as { id: string; why: string }[]) : []).find((x) => x.id === a.id)?.why;
        run.failed++;
        noteAttachment({ ...meta, status: "failed", error: why || t("The driver didn't hand it over.") });
        continue;
      }
      try {
        const file = path.resolve(f.path);
        if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error("The file is outside the temporary folder.");
        const { doc, fresh } = addDocument(documentName(mail.subject, f.name || a.name), fs.readFileSync(file), f.mime || a.mime);
        noteAttachment({ ...meta, docId: doc.id, status: "done" });
        run.seen++;
        if (fresh) run.documents++;
      } catch (e) {
        run.failed++;
        noteAttachment({ ...meta, status: "failed", error: errorMessage(e) });
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Looks like the browser or its sign-in is the problem, not this mail — the rest of the run would fail the same way. */
const DRIVER_DOWN = /sign[- ]?in|anmeld|isn't open|isn't running|not running|no window|chrome|busy with another|debug port|econnrefused|cannot reach/i;

/** Gmail folder name → account, as the mail sync names them. */
async function gmailFolderMap(): Promise<Map<string, string>> {
  const { gmailAccounts, gmailFolder } = await import("@/plugins/gmail/accounts");
  return new Map(gmailAccounts().map((a, i) => [gmailFolder(a, i), a.account]));
}

const flag = globalThis as { __zeffMailAttachments?: boolean; __zeffAttachProgress?: Map<string, AttachmentProgress> };

/**
 * Where a run is, for the page (polled by the button): the mail sync it waits for, then the mails
 * it goes through — and how the last one ended. Per account; in memory, like the run itself.
 */
export type AttachmentProgress = {
  running: boolean;
  /** The button's run holds it (a step inside it ending doesn't make it idle). */
  held: boolean;
  phase: "" | "mail" | "attachments";
  mailsDone: number;
  mailsTotal: number;
  documents: number;
  failed: number;
  last: { at: string; ok: boolean; message: string } | null;
};
const emptyProgress = (): AttachmentProgress => ({ running: false, held: false, phase: "", mailsDone: 0, mailsTotal: 0, documents: 0, failed: 0, last: null });
const progresses = () => (flag.__zeffAttachProgress ??= new Map<string, AttachmentProgress>());
export const attachmentProgress = (): AttachmentProgress => ({ ...(progresses().get(currentAccountId()) ?? emptyProgress()) });
/** Change this account's progress (and keep what it had: the last result stays until the next run ends). */
export function setAttachmentProgress(patch: Partial<AttachmentProgress>): void {
  progresses().set(currentAccountId(), { ...(progresses().get(currentAccountId()) ?? emptyProgress()), ...patch });
}

/**
 * One run of the step. `manual`: from the “Fetch attachments now” button (runs also when the setting
 * says “only on request”, with roomier limits). Returns what happened; nothing here throws.
 */
export async function fetchMailAttachments({ manual = false, now = Date.now() }: { manual?: boolean; now?: number } = {}): Promise<AttachmentRun> {
  const s = attachmentSettings();
  if (!s.enabled) return none();
  if (!manual && s.when === "manual") return none();
  if (!isInstalled("documents")) return none({ message: manual ? t("The Documents plugin is not installed (Menu → Plugins).") : "" });
  if (flag.__zeffMailAttachments) return none({ message: manual ? t("Attachments are already being fetched.") : "" });
  flag.__zeffMailAttachments = true;
  setAttachmentProgress({ running: true, phase: "attachments", mailsDone: 0, mailsTotal: 0, documents: 0, failed: 0 });
  const run = none({ ran: true });
  let tmp = "";
  try {
    const on = installedAttachmentSources().filter((src) => s.sources[src]);
    if (!on.length) return none({ message: manual ? t("No mail source is turned on for attachments.") : "" });
    const limits = manual ? MANUAL_LIMITS : AUTO_LIMITS;
    const started = Date.now();
    const gmailFolders = on.includes("gmail") ? await gmailFolderMap() : new Map<string, string>();
    const all = attachmentCandidates(s, on, gmailFolders, now);
    // Mails still unread are left alone where opening them would mark them read.
    const todo = all.filter((m) => mayOpenMail(m, m.source, s));
    run.unreadLeft = all.length - todo.length;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-attach-"));
    let budget = limits.mails;
    setAttachmentProgress({ mailsTotal: Math.min(todo.length, limits.mails) });
    for (const source of on) {
      const mails = todo.filter((m) => m.source === source);
      if (!mails.length) continue;
      if (budget <= 0 || Date.now() - started > limits.ms) break;
      try {
        await opener(
          source,
          async (call) => {
            for (const mail of mails) {
              throwIfAborted();
              if (budget <= 0 || Date.now() - started > limits.ms) return;
              budget--;
              run.mails++;
              try {
                await processMail(call, mail, s, tmp, run);
                setAttachmentProgress({ mailsDone: run.mails, documents: run.documents, failed: run.failed });
              } catch (e) {
                const message = errorMessage(e).slice(0, 300);
                run.failed++;
                noteAttachment({ source, mailKey: mail.key, attKey: "", status: "failed", error: message });
                if (DRIVER_DOWN.test(message)) throw e;
              }
            }
          },
          Math.max(60000, limits.ms - (Date.now() - started)) + 120000,
        );
      } catch (e) {
        run.error = `${SOURCE_LABELS[source]}: ${errorMessage(e).slice(0, 200)}`;
      }
    }
    run.more = Math.max(0, todo.length - run.mails);
    // The Documents plugin reads what's new and has the knowledge server compile it.
    if (run.documents) {
      try {
        (await import("@/plugins/documents/process")).startProcessing();
      } catch (e) {
        console.error("[mail-attachments] starting the reading:", errorMessage(e));
      }
    }
  } catch (e) {
    run.error = errorMessage(e).slice(0, 200);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    flag.__zeffMailAttachments = false;
    if (!progresses().get(currentAccountId())?.held) setAttachmentProgress({ running: false, phase: "" });
  }
  const parts = [
    run.documents ? t("{n} attachments → documents", { n: run.documents }) : "",
    run.openedUnread ? t("{n} unread mails opened{restored}", { n: run.openedUnread, restored: run.restored ? t(", marked unread again") : "" }) : "",
    run.unreadLeft ? t("{n} unread mails left alone", { n: run.unreadLeft }) : "",
    run.failed ? t("{n} attachments failed", { n: run.failed }) : "",
    run.more ? t("{n} more mails next time", { n: run.more }) : "",
    run.error ? t("attachments: {error}", { error: run.error }) : "",
  ].filter(Boolean);
  run.message = parts.join(", ");
  setAttachmentProgress({ last: { at: new Date().toISOString(), ok: !run.error || run.documents > 0, message: run.message || t("No new attachments.") } });
  return run;
}
