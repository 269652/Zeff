import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { GmailLabelsForm } from "@/components/GmailLabelsForm";
import { MailFoldersForm } from "@/components/MailFoldersForm";
import { apiConnected, driverOf, getConnector } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { getPref } from "@/lib/prefs";
import { getMailSettings } from "@/lib/mail/store";
import { GMAIL_LABELS_PREF } from "@/lib/mail/sync";
import { isInstalled } from "@/plugins/state";
import { EMPTY_ACCOUNT, getMailAccount, mailboxName, type MailAccount } from "@/plugins/imap-mail/config";
import { providerById, type MailMethod } from "@/plugins/imap-mail/presets";
import { chooseMailMethodAction, saveMailAccountAction, testMailAccountAction } from "@/plugins/imap-mail/server-actions";
import { methodHint, methodLabel, providerNote } from "@/plugins/imap-mail/ui/labels";
import { ServerFields } from "@/plugins/imap-mail/ui/ServerFields";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("E-Mail accounts") };
}

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const LINK = "text-indigo-600 hover:underline dark:text-indigo-400";

type Search = { ok?: string; error?: string; provider?: string; method?: string };

/**
 * One mail account's page (Settings → E-Mail → an account): an IMAP / POP3 account's address, password, servers and folders (a new
 * one: `new`, its provider and way from the add flow); Outlook's folders and Gmail's accounts or labels, with how each is read.
 */
export default async function MailAccountPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  await connection();
  const { key } = await params;
  const sp = await searchParams;
  const alerts = (
    <>
      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      {sp.error && (
        <p role="alert" className="alert-error">
          {sp.error}
        </p>
      )}
    </>
  );
  const head = (title: string) => (
    <>
      <Link href="/settings/mail" className="text-sm text-zinc-500 hover:underline">
        ← {t("E-Mail accounts")}
      </Link>
      <h1 className="text-xl font-semibold">{title}</h1>
      {alerts}
    </>
  );
  if (key === "outlook" || key === "gmail") return <div className="mx-auto max-w-2xl space-y-4">{head(key === "outlook" ? "Outlook" : "Gmail")}{key === "outlook" ? <OutlookPart /> : <GmailPart />}</div>;
  let account: MailAccount;
  if (key === "new") {
    const p = providerById(sp.provider);
    const method = sp.method === "pop3" ? "pop3" : "imap";
    const incoming = method === "pop3" ? p.pop3 : p.imap;
    account = { ...EMPTY_ACCOUNT, id: "", method, provider: p.id, imapHost: incoming.host, imapPort: incoming.port, imapTls: incoming.tls, smtpHost: p.smtp.host, smtpPort: p.smtp.port, smtpSecurity: p.smtp.security, saveSent: method === "imap" && !p.keepsSent };
  } else {
    const found = getMailAccount(key);
    if (!found) notFound();
    account = found;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {head(account.id ? mailboxName(account) : t("Add account: {provider}", { provider: account.provider === "other" ? t("Other provider") : providerById(account.provider).name }))}
      <AccountForm a={account} />
    </div>
  );
}

/** How Outlook / Gmail is read — switched here (the API's sign-in itself is on the Connections page). */
function MethodSwitch({ provider, current, connected }: { provider: "gmail" | "outlook"; current: MailMethod; connected: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {t("Read: {method}", { method: methodLabel(t, current) })}
        {current === "api" && !connected && (
          <>
            {" — "}
            <Link href={`/settings/connections?provider=${provider === "gmail" ? "google" : "microsoft"}#api`} className={LINK}>
              {t("sign in on the Connections page")}
            </Link>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {(["api", "browser"] as const)
          .filter((m) => m !== current)
          .map((m) => (
            <form key={m} action={chooseMailMethodAction}>
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="method" value={m} />
              <button className="btn btn-sm" title={methodHint(t, m)}>
                {t("Switch to: {method}", { method: methodLabel(t, m) })}
              </button>
            </form>
          ))}
        <Link href={`/settings/mail/account/new?provider=${provider}&method=imap`} className="btn btn-sm">
          {t("Add it over IMAP instead")}
        </Link>
      </div>
    </div>
  );
}

async function OutlookPart() {
  if (!isInstalled("outlook-mail")) return <p className="text-sm text-zinc-500">{t("Not added.")} <Link href="/settings/mail/add?provider=outlook" className={LINK}>{t("Add account")}</Link></p>;
  const api = driverOf("outlook-mail") === "api";
  return (
    <section className="card space-y-3 p-4">
      <MethodSwitch provider="outlook" current={api ? "api" : "browser"} connected={apiConnected(getConnector("microsoft"))} />
      <MailFoldersForm folders={getMailSettings().folders} />
    </section>
  );
}

async function GmailPart() {
  if (!isInstalled("gmail")) return <p className="text-sm text-zinc-500">{t("Not added.")} <Link href="/settings/mail/add?provider=gmail" className={LINK}>{t("Add account")}</Link></p>;
  const api = driverOf("gmail") === "api";
  if (api)
    return (
      <section className="card space-y-3 p-4">
        <MethodSwitch provider="gmail" current="api" connected={apiConnected(getConnector("google"))} />
        <GmailLabelsForm labels={getPref<string[]>(GMAIL_LABELS_PREF, [])} />
      </section>
    );
  const { GmailAccountsForm } = await import("@/plugins/gmail/GmailAccountsForm");
  const { gmailAccounts, gmailFolder, signedInGmailAccounts } = await import("@/plugins/gmail/accounts");
  const accounts = gmailAccounts();
  return (
    <section id="gmail-accounts" className="card space-y-3 p-4">
      <MethodSwitch provider="gmail" current="browser" connected />
      <p className="text-sm text-zinc-500">
        {t("Which Gmail accounts the mail sync reads — the Google accounts signed in to this account's automation Chrome. “Add account” brings Google's sign-in to the front there; you sign in yourself (Zeff types nothing), then “Reload”.")}
      </p>
      <GmailAccountsForm signedIn={await signedInGmailAccounts()} configured={accounts} />
      <p className="text-xs text-zinc-400">{t("Read into the folders: {folders}", { folders: accounts.map((a, i) => gmailFolder(a, i)).join(", ") })}</p>
    </section>
  );
}

/** An IMAP / POP3 account: who you are, the password, the servers, the folders — saved, or saved and tested. */
function AccountForm({ a }: { a: MailAccount }) {
  const note = providerNote(t, a.provider, a.method);
  return (
    <form action={saveMailAccountAction} className="card space-y-3 p-4" data-mail-account-form={a.method}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="provider" value={a.provider} />
      <p className="text-sm text-zinc-500">
        {methodLabel(t, a.method)} — {methodHint(t, a.method)}
      </p>
      {note && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{note}</p>}
      <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">{t("Mailbox")}</legend>
        <label className="block text-sm">
          {t("E-mail address")}
          <input name="address" type="email" required autoComplete="off" defaultValue={a.address} className={`${field} mt-1`} placeholder="name@example.de" />
        </label>
        <label className="block text-sm">
          {t("Password for mail programs")}
          <input name="password" type="password" autoComplete="new-password" className={`${field} mt-1`} placeholder={a.password ? t("(set — leave empty to keep)") : ""} />
        </label>
        <label className="block text-sm">
          {t("User name")}
          <input name="user" autoComplete="off" defaultValue={a.user} className={`${field} mt-1`} placeholder={t("(the e-mail address)")} />
        </label>
        <label className="block text-sm">
          {t("Your name, as the people you write to see it")}
          <input name="senderName" defaultValue={a.senderName} className={`${field} mt-1`} />
        </label>
        <label className="block text-sm">
          {t("Name of the mailbox in Zeff")}
          <input name="name" defaultValue={a.name} className={`${field} mt-1`} placeholder={a.provider === "other" ? "" : providerById(a.provider).name} />
        </label>
        <label className="block text-sm">
          {t("Read with")}
          <select name="method" defaultValue={a.method} className={`${field} mt-1`}>
            <option value="imap">{methodLabel(t, "imap")}</option>
            <option value="pop3">{methodLabel(t, "pop3")}</option>
          </select>
        </label>
      </fieldset>
      <ServerFields method={a.method} initial={{ imapHost: a.imapHost, imapPort: a.imapPort, imapTls: a.imapTls, smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecurity: a.smtpSecurity }} />
      {a.method === "imap" ? (
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">{t("Folders")}</legend>
          {a.serverFolders.length ? (
            <>
              <input type="hidden" name="foldersShown" value="1" />
              <p className="text-xs text-zinc-500">{t("The folders read (the Sent folder is always read too):")}</p>
              <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                {a.serverFolders
                  .filter((f) => f !== a.sentFolder)
                  .map((f) => (
                    <label key={f} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="folders" value={f} defaultChecked={a.folders.includes(f)} />
                      {f.toUpperCase() === "INBOX" ? t("Inbox") : f}
                    </label>
                  ))}
              </div>
              <label className="block text-sm">
                {t("Archive folder")}
                <select name="archiveFolder" defaultValue={a.archiveFolder} className={`${field} mt-1`}>
                  <option value="">{t("(found on the server)")}</option>
                  {a.serverFolders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t("Sent folder")}
                <select name="sentFolder" defaultValue={a.sentFolder} className={`${field} mt-1`}>
                  <option value="">{t("(none)")}</option>
                  {a.serverFolders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="text-xs text-zinc-500">{t("The inbox is read. After a successful test, the server's folders are offered here to choose from.")}</p>
          )}
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="saveSent" defaultChecked={a.saveSent} />
            {t("Put a copy of each mail sent in the Sent folder (turn off if your provider does it itself)")}
          </label>
        </fieldset>
      ) : (
        <p className="text-xs text-zinc-500">{t("POP3 reads the inbox only — each new mail once, into the folder “{name}”. Nothing is deleted on the server. What you send is kept in Zeff (the server has no Sent folder for it).", { name: a.id ? mailboxName(a) : t("(the account's name)") })}</p>
      )}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="hidden" name="markReadShown" value="1" />
        <input type="checkbox" name="markReadOnOpen" defaultChecked={a.markReadOnOpen} />
        {a.method === "pop3" ? t("Mark a mail read when I open it (in Zeff — POP3 has no read state on the server)") : t("Mark a mail read when I open it (in Zeff and on the server)")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm">{t("Save")}</button>
        <button formAction={testMailAccountAction} className="btn btn-sm">
          {t("Save and test the connection")}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {t("The password is kept in this Zeff account's settings on this computer, like the other services' keys — not encrypted. Use the separate password for mail programs where your provider offers one.")}
      </p>
    </form>
  );
}
