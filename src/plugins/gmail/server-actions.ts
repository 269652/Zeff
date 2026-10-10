"use server";

import { errorMessage } from "@/lib/errors";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Gmail: its server actions (each answers an ActionState unless it says otherwise). */

/** Gmail's settings, "Konto hinzufügen": Google's add-account sign-in in the automation Chrome — you sign in there yourself. */
export async function openGmailAddAccountAction(): Promise<ActionState> {
  try {
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome("https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail", "Googles Anmeldung");
    return r.ok ? { ok: true, message: "Googles Anmeldung ist im Automations-Chrome vorne — melde dich dort mit dem weiteren Konto an, dann hier „Neu laden“." } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Gmail's settings: the accounts its sync reads (address or Gmail's account number, and a name). */
export async function saveGmailAccountsAction(list: { account: string; label: string }[]): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("gmail")) return { ok: false, error: "Gmail ist nicht installiert." };
    const accounts = (Array.isArray(list) ? list : [])
      .map((a) => ({ account: String(a?.account ?? "").trim().toLowerCase(), label: String(a?.label ?? "").trim().slice(0, 40) }))
      .filter((a) => a.account);
    const bad = accounts.find((a) => !/^\d{1,2}$/.test(a.account) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.account));
    if (bad) return { ok: false, error: `„${bad.account}“: eine Adresse (name@gmail.com) oder Gmails Kontonummer (0, 1 …).` };
    if (new Set(accounts.map((a) => a.account)).size !== accounts.length) return { ok: false, error: "Ein Konto doppelt." };
    const { setGmailAccounts } = await import("@/plugins/gmail/accounts");
    setGmailAccounts(accounts.slice(0, 10));
    revalidateAll();
    return { ok: true, message: accounts.length ? `${accounts.length} Konto${accounts.length > 1 ? "en" : ""} — der nächste Sync liest sie.` : "Kein Konto — Gmail wird nicht gelesen." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
