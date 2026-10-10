"use server";

import { errorMessage } from "@/lib/errors";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Gmail: its server actions (each answers an ActionState unless it says otherwise). */

/** Gmail's settings, "Konto hinzufügen": Google's add-account sign-in in the automation Chrome — you sign in there yourself. */
export async function openGmailAddAccountAction(): Promise<ActionState> {
  try {
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome("https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail", "Googles Anmeldung");
    return r.ok ? { ok: true, message: "Google's sign-in is in front in the automation Chrome — sign in there with the other account, then “Reload” here." } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Gmail's settings: the accounts its sync reads (address or Gmail's account number, and a name). */
export async function saveGmailAccountsAction(list: { account: string; label: string }[]): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("gmail")) return { ok: false, error: "Gmail is not installed." };
    const accounts = (Array.isArray(list) ? list : [])
      .map((a) => ({ account: String(a?.account ?? "").trim().toLowerCase(), label: String(a?.label ?? "").trim().slice(0, 40) }))
      .filter((a) => a.account);
    const bad = accounts.find((a) => !/^\d{1,2}$/.test(a.account) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.account));
    if (bad) return { ok: false, error: `“${bad.account}”: an address (name@gmail.com) or Gmail's account number (0, 1 …).` };
    if (new Set(accounts.map((a) => a.account)).size !== accounts.length) return { ok: false, error: "An account is listed twice." };
    const { setGmailAccounts } = await import("@/plugins/gmail/accounts");
    setGmailAccounts(accounts.slice(0, 10));
    revalidateAll();
    return { ok: true, message: accounts.length ? `${accounts.length} account${accounts.length > 1 ? "s" : ""} — the next sync reads them.` : "No account — Gmail isn't read." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
