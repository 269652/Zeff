"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Plugins (connectors and AI tools): installed or not
// ---------------------------------------------------------------------------

/** Install or uninstall a plugin — its data stays; what it does (menu, pages, syncs) comes or goes. */
export async function setPluginInstalledAction(id: string, installed: boolean): Promise<ActionState> {
  try {
    const { isPluginId, pluginById } = await import("@/plugins/catalog");
    if (!isPluginId(id)) return { ok: false, error: t("Unknown plugin.") };
    const { dependents, setInstalled } = await import("@/plugins/state");
    // Uninstalled: what builds on it goes too (it stays set, and is back once this is).
    const along = installed ? [] : dependents(id);
    const ids = setInstalled(id, !!installed);
    // Knowledge in or out: the launcher starts or stops this account's knowledge server.
    (await import("@/plugins/knowledge/instances")).writeKnowledgeInstances();
    revalidateAll();
    const names = (list: string[]) => list.map((x) => (isPluginId(x) ? pluginById(x).name : x)).join(", ");
    return {
      ok: true,
      message:
        (installed ? t("{name} installed.", { name: pluginById(id).name }) : t("{name} uninstalled.", { name: pluginById(id).name })) +
        (ids.length > 1 ? ` ${t("Installed along with it: {names}.", { names: names(ids.slice(1)) })}` : "") +
        (along.length ? ` ${t("Not available without it: {names}.", { names: names(along) })}` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The language Zeff speaks in this account (Settings) — one of the installed language bundles. */
export async function setLanguageAction(lang: string): Promise<ActionState> {
  try {
    const { setLanguage } = await import("@/lib/i18n/server");
    setLanguage(String(lang));
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Setup's "Open all sign-in pages": a tab per service that isn't signed in yet, in the automation Chrome — you sign in there yourself. */
export async function openAllSignInsAction(): Promise<ActionState> {
  try {
    const { listLogins } = await import("@/lib/logins");
    const { openServiceLogin } = await import("@/lib/attention");
    const { logins } = await listLogins();
    const open = logins.filter((l) => l.state !== "ok");
    if (!open.length) return { ok: true, message: t("Everything is signed in.") };
    const failed: string[] = [];
    for (const l of open) if (!(await openServiceLogin(l.service)).ok) failed.push(l.label);
    revalidatePath("/settings/connections");
    return failed.length
      ? { ok: false, error: t("Couldn't open: {names}. Is a browser installed?", { names: failed.join(", ") }) }
      : { ok: true, message: t("{n} sign-in pages are open in the automation Chrome — sign in to each, then click Check all.", { n: open.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** "Install" on the This PC list: winget (Homebrew) installs it in the background; `all` takes every missing program that can be installed. */
export async function installPrerequisiteAction(id: string): Promise<ActionState> {
  try {
    const { prerequisites } = await import("@/lib/prerequisites");
    const { installPlan, startInstall } = await import("@/lib/prerequisites-install");
    const { hasCommand } = await import("@/plugins/documents/poppler");
    const rows = prerequisites();
    const todo = id === "all" ? rows.filter((r) => !r.found && installPlan(r.id, process.platform, hasCommand)) : rows.filter((r) => r.id === id && !r.found);
    if (!todo.length) return { ok: false, error: t("Nothing to install.") };
    for (const r of todo) startInstall(r.id, { plan: installPlan(r.id, process.platform, hasCommand), found: () => !!(rows.length && prerequisites().find((x) => x.id === r.id)?.found), after: () => void signInAfterInstall(r.id) });
    return { ok: true, message: t("Installing {n} program(s) — this takes a few minutes.", { n: todo.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A freshly installed AI CLI: its sign-in opens right away (the browser asks you to sign in). */
async function signInAfterInstall(id: string): Promise<void> {
  if (id !== "claude" && id !== "codex" && id !== "copilot") return;
  (await import("@/lib/ai-login")).startAiLogin(id);
}

/** What the installs are doing (polled by the This PC list). */
export async function installStatusAction(): Promise<{ id: string; state: string; out: string; note: string; at: string }[]> {
  const { installStates } = await import("@/lib/prerequisites-install");
  return installStates().map(({ id, state, out, note, at }) => ({ id, state, out, note: note ?? "", at }));
}

/** "Sign in" on the This PC list: the AI CLI's own login (opens the browser; Zeff never sees a password). */
export async function aiLoginAction(provider: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    if (!isAiProvider(provider)) return { ok: false, error: t("Unknown provider.") };
    const { startAiLogin } = await import("@/lib/ai-login");
    const s = startAiLogin(provider);
    return s.state === "failed" ? { ok: false, error: s.out } : { ok: true, message: t("The sign-in page opens in your browser — sign in there.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Where the AI CLIs' sign-ins are: running / done / failed (with the address when the browser didn't open), and whether each is signed in. */
export async function aiLoginStatusAction(): Promise<{ provider: string; state: string; url: string | null; out: string; signedIn: boolean | null }[]> {
  const { AI_PROVIDERS } = await import("@/lib/ai/shared");
  const { aiSignedIn, loginStates, loginCommands } = await import("@/lib/ai-login");
  const states = new Map(loginStates().map((s) => [s.provider, s]));
  return Promise.all(
    AI_PROVIDERS.filter((p) => loginCommands(p)).map(async (p) => {
      const s = states.get(p);
      return { provider: p, state: s?.state ?? "idle", url: s?.url ?? null, out: s?.out ?? "", signedIn: s?.state === "running" ? null : s?.state === "done" && !loginCommands(p)?.status ? true : await aiSignedIn(p) };
    }),
  );
}

/** The diagnostics report (redacted) — shown on the page, copied or saved by the user; Zeff sends it nowhere. */
export async function diagnosticsAction(): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const { diagnosticsReport } = await import("@/lib/diagnostics");
    return { ok: true, text: await diagnosticsReport() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
