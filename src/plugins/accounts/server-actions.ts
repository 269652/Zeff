"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { accountsOn, revalidateAll, type ActionState } from "@/app/action-helpers";

/** Accounts: its server actions (each answers an ActionState unless it says otherwise). */

/** Into another account (Accounts plugin) — where to go there (its first tab: its plugins differ). */
export async function switchAccountAction(id: string): Promise<ActionState & { href?: string }> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const a = (await import("@/lib/accounts")).switchAccount(String(id));
    revalidateAll();
    const { appTabs } = await import("@/plugins/tabs");
    return { ok: true, message: t("Now in “{name}”.", { name: a.name }), href: appTabs()[0]?.href ?? "/plugins" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A new account — empty, or with another's settings and configuration (and, `shareChrome`, its sign-ins). Its id. */
export async function createAccountAction(v: { name: string; color: string; copyFrom?: string; shareChrome?: boolean }): Promise<ActionState & { id?: string }> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const { account, copied } = await (await import("@/lib/accounts")).createAccount({
      name: String(v.name ?? ""),
      color: String(v.color ?? ""),
      copyFrom: v.copyFrom ? String(v.copyFrom) : undefined,
      shareChrome: !!v.shareChrome,
    });
    revalidatePath("/accounts");
    return {
      ok: true,
      id: account.id,
      message: copied ? t("Account “{name}” created — {n} settings taken over.", { name: account.name, n: copied }) : t("Account “{name}” created.", { name: account.name }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateAccountAction(id: string, v: { name?: string; color?: string; host?: string; workerSetup?: boolean }): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const { updateAccount } = await import("@/db/accounts");
    const a = updateAccount(String(id), { name: v.name === undefined ? undefined : String(v.name), color: v.color === undefined ? undefined : String(v.color), host: v.host === undefined ? undefined : String(v.host), workerSetup: v.workerSetup === undefined ? undefined : v.workerSetup === true });
    revalidateAll();
    return { ok: true, message: t("“{name}” saved.", { name: a.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An account off the list — its folder set aside (data/accounts/.deleted), not deleted. */
export async function deleteAccountAction(id: string): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const to = (await import("@/lib/accounts")).deleteAccount(String(id));
    revalidatePath("/accounts");
    return { ok: true, message: t("Account removed — its data is in {dir}.", { dir: to }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
