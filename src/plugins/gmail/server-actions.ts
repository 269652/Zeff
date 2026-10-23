"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Gmail: its server actions (each answers an ActionState unless it says otherwise). */

/** Gmail's settings, "Konto hinzufügen": Google's add-account sign-in in the automation Chrome — you sign in there yourself. */
export async function openGmailAddAccountAction(): Promise<ActionState> {
  try {
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome("https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail", t("Google's sign-in"));
    return r.ok ? { ok: true, message: t("Google's sign-in is in front in the automation Chrome — sign in there with the other account, then “Reload” here.") } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Gmail's settings: the accounts its sync reads (address or Gmail's account number, and a name). */
export async function saveGmailAccountsAction(list: { account: string; label: string }[]): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("gmail")) return { ok: false, error: t("Gmail is not installed.") };
    const accounts = (Array.isArray(list) ? list : [])
      .map((a) => ({ account: String(a?.account ?? "").trim().toLowerCase(), label: String(a?.label ?? "").trim().slice(0, 40) }))
      .filter((a) => a.account);
    const bad = accounts.find((a) => !/^\d{1,2}$/.test(a.account) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.account));
    if (bad) return { ok: false, error: t("“{account}”: an address (name@gmail.com) or Gmail's account number (0, 1 …).", { account: bad.account }) };
    if (new Set(accounts.map((a) => a.account)).size !== accounts.length) return { ok: false, error: t("An account is listed twice.") };
    const { setGmailAccounts } = await import("@/plugins/gmail/accounts");
    setGmailAccounts(accounts.slice(0, 10));
    revalidateAll();
    const n = accounts.length;
    return { ok: true, message: !n ? t("No account — Gmail isn't read.") : n === 1 ? t("1 account — the next sync reads it.") : t("{n} accounts — the next sync reads them.", { n }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * A todo's mail — your click on its "Send" or "Save as draft" (with Gmail's write access): through Gmail's API, into the thread
 * of the Gmail mail the todo came from; then off the todo and noted there.
 */
export async function runGmailComposeAction(todoId: number, index: number, mode: "send" | "draft"): Promise<ActionState> {
  try {
    const { runGmailComposeOnTodo } = await import("./run");
    const r = await runGmailComposeOnTodo(Number(todoId), Number(index), mode === "draft" ? "draft" : "send");
    revalidateAll();
    return { ok: true, message: r.what };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An inbox row's Gmail conversation archived (out of the inbox — nothing deleted) or marked unread: your click. */
export async function gmailRowChangeAction(rowId: number, what: "archive" | "unread"): Promise<ActionState> {
  try {
    const { gmailRowChange } = await import("./run");
    const message = await gmailRowChange(Number(rowId), what === "unread" ? "unread" : "archive");
    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
