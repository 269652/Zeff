import { apiConnected, driverOf, getConnector } from "@/lib/connectors/store";
import { isInstalled } from "@/plugins/state";
import type { MailMethod, ProviderId } from "@/plugins/imap-mail/presets";
import { getMailSettings } from "./store";

/**
 * Every mail account Zeff reads, in one list (Settings → E-Mail) — whatever keeps it: Outlook (its plugin; Microsoft's API or
 * the automation Chrome), Gmail (its plugin; Google's API — one account — or the automation Chrome — the accounts set there),
 * and the mail accounts read over IMAP or POP3 (each with its own settings). Only an adapter: each keeps its settings where it
 * always has. Server only.
 */

export type MailAccountRow = {
  /** "outlook", "gmail" (Google's API), "gmail:<n or address>" (a Gmail account in the automation Chrome), or an account's id ("m1"). */
  key: string;
  provider: ProviderId;
  name: string;
  address: string;
  method: MailMethod;
  /** ok: the last sync worked; error: it didn't; never: not read yet; signin: the API isn't signed in. */
  status: "ok" | "error" | "never" | "signin";
  lastSyncAt: string | null;
  lastResult: string | null;
  /** Where it is edited. */
  href: string;
};

/** The mail accounts, Outlook's and Gmail's first, then the IMAP / POP3 ones in the order added. */
export async function listMailAccounts(): Promise<MailAccountRow[]> {
  const out: MailAccountRow[] = [];
  const shared = getMailSettings();
  // (Outlook and Gmail share the one mail sync: its last result is theirs.)
  const sharedStatus = (signedIn = true): Pick<MailAccountRow, "status" | "lastSyncAt" | "lastResult"> => ({
    status: !signedIn ? "signin" : shared.lastSyncAt ? (shared.lastOk ? "ok" : "error") : "never",
    lastSyncAt: shared.lastSyncAt,
    lastResult: shared.lastResult,
  });
  if (isInstalled("outlook-mail")) {
    const api = driverOf("outlook-mail") === "api";
    const ms = getConnector("microsoft");
    out.push({ key: "outlook", provider: "outlook", name: "Outlook", address: api ? ms.account : "", method: api ? "api" : "browser", ...sharedStatus(!api || apiConnected(ms)), href: "/settings/mail/account/outlook" });
  }
  if (isInstalled("gmail")) {
    if (driverOf("gmail") === "api") {
      const g = getConnector("google");
      out.push({ key: "gmail", provider: "gmail", name: "Gmail", address: g.account, method: "api", ...sharedStatus(apiConnected(g)), href: "/settings/mail/account/gmail" });
    } else {
      const { gmailAccounts, gmailFolder } = await import("@/plugins/gmail/accounts");
      gmailAccounts().forEach((a, i) =>
        out.push({ key: `gmail:${a.account}`, provider: "gmail", name: gmailFolder(a, i), address: /@/.test(a.account) ? a.account : "", method: "browser", ...sharedStatus(), href: "/settings/mail/account/gmail" }),
      );
    }
  }
  const { mailAccounts, mailboxName } = await import("@/plugins/imap-mail/config");
  for (const a of mailAccounts())
    out.push({
      key: a.id,
      provider: a.provider,
      name: mailboxName(a),
      address: a.address,
      method: a.method,
      status: a.lastSyncAt ? (a.lastOk ? "ok" : "error") : "never",
      lastSyncAt: a.lastSyncAt,
      lastResult: a.lastResult,
      href: `/settings/mail/account/${a.id}`,
    });
  return out;
}
