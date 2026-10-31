"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { syncGitlabAction } from "@/plugins/gitlab/server-actions";
import { accountsOn, revalidateAll, type ActionState } from "@/app/action-helpers";
import { integrationServer } from "@/lib/integrations/server";
import { syncKeepAction } from "@/plugins/keep/server-actions";
import { syncTeamsAction } from "@/plugins/teams/server-actions";
import { syncWhatsappAction } from "@/plugins/whatsapp/server-actions";
import { syncSignalAction } from "@/plugins/signal/server-actions";
import { syncMailAction } from "./mail";

/** A service's sign-in shown in the automation Chrome (its tab at the front, else a new one) — you sign in there yourself. */
export async function openServiceLoginAction(service: string): Promise<ActionState> {
  try {
    const { openServiceLogin, serviceLabel } = await import("@/lib/attention");
    if (!serviceLabel(service)) return { ok: false, error: t("Unknown service.") };
    const r = await openServiceLogin(service);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The menu's "Anpassen": an application's place (header, menu, hidden) — or another entry hidden or
 * shown — or a section's new order (`order`: its entries' addresses, "group:<plugin>" for plugins).
 */
export async function saveMenuAction(change: { href?: string; place?: string; hidden?: boolean; order?: string[] }): Promise<ActionState> {
  try {
    const { getMenuPrefs, setMenuPrefs } = await import("@/plugins/tabs");
    const cur = getMenuPrefs();
    if (Array.isArray(change?.order)) {
      const keys = change.order.map(String).filter((k) => k.startsWith("/") || k.startsWith("group:"));
      // The section's entries last, in their new order (only their order among themselves counts).
      setMenuPrefs({ order: [...cur.order.filter((k) => !keys.includes(k)), ...keys] });
      revalidatePath("/", "layout");
      return { ok: true, message: t("Saved.") };
    }
    const href = String(change?.href ?? "");
    if (!href.startsWith("/")) return { ok: false, error: t("Not a menu entry.") };
    if (change.place === "header" || change.place === "menu" || change.place === "hidden") setMenuPrefs({ place: { ...cur.place, [href]: change.place } });
    else if (typeof change.hidden === "boolean") setMenuPrefs({ hidden: change.hidden ? [...new Set([...cur.hidden, href])] : cur.hidden.filter((h) => h !== href) });
    revalidatePath("/", "layout");
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A header tab's dropdown (its plugin's entries — Kanban: the boards), loaded when it opens. */
export async function tabMenuAction(tab: string): Promise<import("@/plugins/tab-menus-shared").TabMenuItem[]> {
  try {
    return await (await import("@/plugins/tab-menus")).tabMenu(String(tab));
  } catch {
    return [];
  }
}

/** The setup's end (or skipped): done — on to the sign-ins (Logins page). */
export async function finishSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  revalidateAll();
  redirect("/todos");
}

/** The setup skipped: done, home. */
export async function skipSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  redirect("/");
}

/** The Logins page: ask a service's driver whether it's signed in (read-only — nothing opened, Chrome not started). */
export async function checkLoginAction(service: string): Promise<ActionState> {
  try {
    const { serviceLabel } = await import("@/lib/attention");
    if (!serviceLabel(service)) return { ok: false, error: t("Unknown service.") };
    const { checkLogin } = await import("@/lib/logins");
    const r = await checkLogin(service);
    revalidatePath("/settings/connections");
    return r.state === "ok" ? { ok: true, message: r.detail } : { ok: false, error: r.detail };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Logins page's "Alle prüfen": each checkable service in turn (they share one Chrome). */
export async function checkAllLoginsAction(): Promise<ActionState> {
  try {
    const { checkLogin, listLogins } = await import("@/lib/logins");
    const { logins } = await listLogins();
    let ok = 0;
    const todo = logins.filter((l) => l.checkable);
    for (const l of todo) if ((await checkLogin(l.service)).state === "ok") ok++;
    revalidatePath("/settings/connections");
    return { ok: true, message: t("{ok} of {n} signed in.", { ok, n: todo.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Signed in: try the service again (its sync, or its status) — the request goes once it works. */
export async function retryServiceAction(service: string): Promise<ActionState> {
  try {
    if (service === "teams") return await syncTeamsAction();
    if (service === "outlook" || service === "gmail") return await syncMailAction();
    if (service === "whatsapp") return await syncWhatsappAction();
    if (service === "signal") return await syncSignalAction();
    if (service === "keep") return await syncKeepAction();
    if (service === "gitlab") return await syncGitlabAction();
    if (service === "jira") {
      const { syncAndWait } = await import("@/lib/sync/registry");
      const r = await syncAndWait("jira");
      revalidateAll();
      return r.lastOk ? { ok: true, message: t("Jira works again.") } : { ok: false, error: r.lastMessage ?? t("Failed.") };
    }
    // The mounted integrations' (Chrono, Punch): their driver's status check.
    const own = integrationServer(service)?.service;
    if (own) {
      const msg = await own.status();
      revalidateAll();
      return /not signed in/i.test(msg) ? { ok: false, error: msg } : { ok: true, message: msg };
    }
    return { ok: false, error: t("Unknown service.") };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** A request put off: gone till the service asks again. */
export async function dismissAttentionAction(key: string): Promise<ActionState> {
  const { clearAttention } = await import("@/lib/attention");
  clearAttention(String(key));
  revalidateAll();
  return { ok: true };
}

/** Into a new account and its setup assistant. */
export async function startSetupAction(id: string): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    await (await import("@/lib/accounts")).startSetup(String(id));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  revalidateAll();
  redirect("/setup");
}

/**
 * Windows' folder dialog, opened on this machine (Zeff runs here) — the folder picked, or null
 * when cancelled. In front of the other windows; the server isn't held up while it's open.
 */
export async function pickFolderAction(initial?: string): Promise<{ ok: boolean; path?: string | null; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: t("The folder dialog is only available on Windows — please type the path.") };
  const { execFile } = await import("node:child_process");
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = $env:ZEFF_PICK_TITLE",
    "$d.ShowNewFolderButton = $true",
    "if ($env:ZEFF_PICK_INITIAL -and (Test-Path -LiteralPath $env:ZEFF_PICK_INITIAL)) { $d.SelectedPath = $env:ZEFF_PICK_INITIAL }",
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  return new Promise((resolve) =>
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 5 * 60000, windowsHide: true, env: { ...process.env, ZEFF_PICK_INITIAL: initial ?? "", ZEFF_PICK_TITLE: t("Folder for Zeff backups") } },
      (err, out) => (err ? resolve({ ok: false, error: t("The dialog didn't open: {error}", { error: errorMessage(err) }) }) : resolve({ ok: true, path: String(out).trim() || null })),
    ),
  );
}
