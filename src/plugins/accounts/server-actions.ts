"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
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
    return { ok: true, message: `Now in “${a.name}”.`, href: appTabs()[0]?.href ?? "/plugins" };
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
    return { ok: true, id: account.id, message: `Account “${account.name}” created${copied ? ` — ${copied} settings taken over` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateAccountAction(id: string, v: { name?: string; color?: string }): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const { updateAccount } = await import("@/db/accounts");
    const a = updateAccount(String(id), { name: v.name === undefined ? undefined : String(v.name), color: v.color === undefined ? undefined : String(v.color) });
    revalidateAll();
    return { ok: true, message: `“${a.name}” saved.` };
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
    return { ok: true, message: `Account removed — its data is in ${to}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
