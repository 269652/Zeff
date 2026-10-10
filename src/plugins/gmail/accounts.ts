import { getPref, setPref } from "@/lib/prefs";

/** A Gmail account the sync reads: its address (or Gmail's account number, mail/u/<n>) and a name for it. */
export type GmailAccount = { account: string; label: string };

const KEY = "plugin:gmail";

/** The accounts the Gmail plugin reads — by default the first one signed in in the automation Chrome. */
export const gmailAccounts = (): GmailAccount[] => {
  const list = getPref<{ accounts?: GmailAccount[] }>(KEY, {}).accounts;
  // Never set: the first one signed in; set to none: none.
  return list ?? [{ account: "0", label: "" }];
};

export const setGmailAccounts = (accounts: GmailAccount[]) => setPref(KEY, { accounts });

/** The folder an account's mails are kept in: the first one's (unnamed) "Gmail" — as before there were several —, the others' "Gmail · <name or address>". */
export const gmailFolder = (a: GmailAccount, index: number) => (a.label ? `Gmail · ${a.label}` : index === 0 ? "Gmail" : `Gmail · ${a.account}`);

/** A Google account signed in in the automation Chrome (Google's account list). */
export type SignedInGmail = { email: string; name: string; number: number };

/** The Google accounts signed in in the account's automation Chrome — null: Chrome isn't running (or didn't answer). */
export async function signedInGmailAccounts(): Promise<SignedInGmail[] | null> {
  const { automationCdp, automationEnv, driverPath } = await import("@/plugins/drivers");
  const up = await fetch(`${automationCdp("gmail")}/json/version`, { signal: AbortSignal.timeout(2500) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) return null;
  try {
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("gmail")], env: automationEnv(), label: "Gmail accounts" },
      async (call) => resultToPayload(await call("gmail_accounts", {})),
      30000,
    );
    const data = (typeof out === "string" ? JSON.parse(out) : out) as { accounts?: SignedInGmail[] };
    return Array.isArray(data.accounts) ? data.accounts : null;
  } catch {
    return null;
  }
}
