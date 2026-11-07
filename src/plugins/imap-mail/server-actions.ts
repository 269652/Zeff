"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/redirect";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * Settings → E-Mail: the mail accounts added, changed, tested, read now or removed. Choosing how an account is read installs
 * what it needs (Outlook Mail, Gmail, the IMAP / POP3 accounts' plugin) — nobody has to look for a plugin first.
 */

const LIST = "/settings/mail";
const back = (path: string, ok: boolean, msg: string): never => redirect(`${path}?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
const text = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");

async function install(id: "gmail" | "outlook-mail" | "imap-mail"): Promise<void> {
  const { isInstalled, setInstalled } = await import("@/plugins/state");
  if (!isInstalled(id)) setInstalled(id, true);
}

/**
 * The add flow's last step for Gmail and Outlook: their plugin installed, read through the API (signed in on the Connections
 * page) or the automation Chrome (its accounts and folders on the account's page).
 */
export async function chooseMailMethodAction(fd: FormData): Promise<void> {
  const provider = text(fd, "provider");
  const method = text(fd, "method");
  if (provider !== "gmail" && provider !== "outlook") return back(`${LIST}/add`, false, t("Unknown provider."));
  const plugin = provider === "gmail" ? "gmail" : "outlook-mail";
  await install(plugin);
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector(plugin, { driver: method === "api" ? "api" : "cdp" });
  revalidatePath("/", "layout");
  if (method === "api") redirect(`/settings/connections?provider=${provider === "gmail" ? "google" : "microsoft"}#api`);
  redirect(`${LIST}/account/${provider}?ok=${encodeURIComponent(t("Added — read through the automation Chrome."))}`);
}

/** An IMAP / POP3 account saved (`id` empty: added) — then, with `test`, signed in to both servers. Back on its page. */
async function saveAccount(fd: FormData, test: boolean): Promise<never> {
  const { saveMailAccount, settingsOfForm, accountReady } = await import("./config");
  const id = text(fd, "id") || null;
  let path = id ? `${LIST}/account/${id}` : `${LIST}/account/new`;
  let ok = true;
  let msg = t("Saved.");
  try {
    const a = saveMailAccount(id, settingsOfForm(fd));
    path = `${LIST}/account/${a.id}`;
    await install("imap-mail");
    if (test) {
      if (!accountReady(a)) throw new Error(t("Fill in the address, the password and both servers first."));
      const { testImap } = await import("./client");
      const r = await testImap(a);
      if (r.folders.length) saveMailAccount(a.id, { serverFolders: r.folders, ...(r.sentFolder && !a.sentFolder ? { sentFolder: r.sentFolder } : {}) });
      ok = r.ok;
      msg = [r.imap, r.smtp, r.ok ? t("Everything works — the mails are read with the next mail sync.") : ""].filter(Boolean).join(" ");
    }
  } catch (e) {
    ok = false;
    msg = errorMessage(e);
  }
  revalidatePath(LIST, "layout");
  return back(path, ok, msg);
}

export async function saveMailAccountAction(fd: FormData): Promise<void> {
  await saveAccount(fd, false);
}

export async function testMailAccountAction(fd: FormData): Promise<void> {
  await saveAccount(fd, true);
}

/** An account read now: an IMAP / POP3 one by itself, Outlook's and Gmail's with the mail sync they share. */
export async function syncMailAccountAction(fd: FormData): Promise<void> {
  const key = text(fd, "key");
  // In the background: a mailbox can take longer than a request may stay silent (behind the account route's proxy: 30 s, then the
  // page is lost — and lands in another account). Its result is on the account's row when it is done.
  const sync = await import("@/lib/mail/sync");
  if (sync.isMailSyncing()) return back(LIST, false, t("A mail sync is already running."));
  void (/^m\d+$/.test(key) ? sync.syncMailAccount(key) : sync.syncMail()).catch(() => undefined);
  revalidatePath(LIST);
  back(LIST, true, t("Reading the mails — the result shows on the account in a moment (reload the page)."));
}

/**
 * An account removed from the list — its mails stay kept. Outlook / Gmail through the API: their plugin uninstalled; a Gmail
 * account of the automation Chrome: no longer read (the last one: Gmail uninstalled).
 */
export async function removeMailAccountAction(fd: FormData): Promise<void> {
  const key = text(fd, "key");
  const { setInstalled } = await import("@/plugins/state");
  if (/^m\d+$/.test(key)) (await import("./config")).removeMailAccount(key);
  else if (key === "outlook") setInstalled("outlook-mail", false);
  else if (key === "gmail") setInstalled("gmail", false);
  else if (key.startsWith("gmail:")) {
    const { gmailAccounts, setGmailAccounts } = await import("@/plugins/gmail/accounts");
    const left = gmailAccounts().filter((a) => a.account !== key.slice("gmail:".length));
    setGmailAccounts(left);
    if (!left.length) setInstalled("gmail", false);
  }
  revalidatePath("/", "layout");
  back(LIST, true, t("Removed — its mails stay kept."));
}
