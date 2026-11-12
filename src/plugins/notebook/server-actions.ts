"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/redirect";
import { pluginAction } from "@/lib/action-result";
import { t } from "@/lib/i18n/server";
import { answerPermission, askSession, interruptSession, readExecution, restartSession, startExecution, hasSession } from "./sessions";
import { grantNeeds, revokeGrant } from "./grants";
import { cellTimeoutSeconds, languageStatuses, notebookEnabled, setCellTimeoutSeconds, setImageOf, setMemoryLimit, setModeOf, setNetworkAllowed, setNotebookEnabled } from "./runtimes";
import { installedLanguages } from "./languages";
import { isInstalled } from "@/plugins/state";
import type { CodeInput } from "./ai-code";

const run = pluginAction("notebook", () => t("The Notebook plugin is not installed (Menu → Plugins)."));

/** Settings → Notebook: the switch, the time limit. */
export async function saveNotebookSettingsAction(fd: FormData): Promise<void> {
  setNotebookEnabled(fd.get("enabled") === "on");
  setCellTimeoutSeconds(Number(fd.get("timeout")));
  setNetworkAllowed(fd.get("network") === "on");
  setMemoryLimit(String(fd.get("memory") ?? ""));
  await import("@/plugins/contributions");
  for (const l of installedLanguages()) {
    setModeOf(l.id, String(fd.get(`mode.${l.id}`) ?? "auto"));
    setImageOf(l.id, String(fd.get(`image.${l.id}`) ?? ""));
  }
  revalidatePath("/settings/notebook");
  redirect(`/settings/notebook?ok=${encodeURIComponent(t("Saved."))}`);
}

/** What a code block needs to know: may code run, which languages are there. */
export async function notebookStatusAction() {
  return run(async () => ({ enabled: notebookEnabled(), timeout: cellTimeoutSeconds(), languages: await languageStatuses() }));
}

/** A cell started in its page's session; poll it with readCellAction. */
export async function runCellAction(session: string, language: string, code: string, inputs?: string[], name?: string) {
  return run(() => {
    const ex = startExecution({ session: String(session ?? ""), language: String(language ?? ""), code: String(code ?? ""), inputs: Array.isArray(inputs) ? inputs.map(String) : [], name: String(name ?? "") });
    return { id: ex.id, count: ex.count };
  });
}

/** What a run has output so far (the outputs only when they changed since `rev`). */
export async function readCellAction(id: string, rev: number) {
  return run(() => {
    const r = readExecution(String(id ?? ""), Number(rev));
    if (!r.found) throw new Error(t("This run is gone (the session ended)."));
    return { status: r.status!, count: r.count!, rev: r.rev!, permissions: r.permissions ?? [], ...(r.outputs ? { outputs: r.outputs } : {}), ...(r.returned !== undefined ? { returned: r.returned } : {}) };
  });
}

/** Stop the running cell (Python keeps its session; Node.js and Rust end it). */
export async function interruptCellAction(session: string, language: string) {
  return run(() => ({ stopped: interruptSession(String(session ?? ""), String(language ?? "")) }));
}

/** The session ended: variables gone, the next cell starts a new one. */
export async function restartKernelAction(session: string, language: string) {
  return run(() => ({ restarted: restartSession(String(session ?? ""), String(language ?? "")) }));
}

/** The variables of a session (name, type, a preview). */
export async function kernelVariablesAction(session: string, language: string) {
  return run(async () => {
    const r = (await askSession(String(session ?? ""), String(language ?? ""), "vars")) as { items?: { name: string; type: string; preview: string; shape?: string; size?: number }[] };
    return { items: r.items ?? [], running: hasSession(String(session ?? ""), String(language ?? "")) };
  });
}

/** Completions at a place in a cell, from what the session knows. */
export async function kernelCompleteAction(session: string, language: string, code: string, pos: number) {
  return run(async () => {
    const r = (await askSession(String(session ?? ""), String(language ?? ""), "complete", { code: String(code ?? ""), pos: Number(pos) })) as { from?: number; to?: number; items?: string[] };
    return { from: r.from ?? 0, to: r.to ?? 0, items: r.items ?? [] };
  });
}

/** A page as a notebook file (.znb: Jupyter's format with Zeff's blocks on top; .ipynb: the same file for Jupyter). */
export async function exportNotebookAction(pageId: number, kind: string) {
  return run(async () => {
    const { getPage } = await import("@/plugins/workspace/store");
    const { pageToNotebook } = await import("./format");
    const p = getPage(Number(pageId));
    if (!p) throw new Error(t("This page is gone."));
    const nb = pageToNotebook(p.title || "Notebook", p.content, { exportedAt: new Date().toISOString() });
    const base = (p.title || "notebook").replace(/[^\p{L}\p{N}_ .-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "notebook";
    return { filename: `${base}.${kind === "ipynb" ? "ipynb" : "znb"}`, json: JSON.stringify(nb, null, 1) };
  });
}

/** A notebook file (.znb or .ipynb) made a new page — under `parentId` when given. */
export async function importNotebookAction(text: string, parentId: number | null) {
  return run(async () => {
    const { createPage } = await import("@/plugins/workspace/store");
    const { notebookToPage } = await import("./format");
    const raw = String(text ?? "");
    if (raw.length > 40_000_000) throw new Error(t("That file is too big."));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(t("That is not a notebook file (it is not JSON)."));
    }
    const { title, doc } = notebookToPage(json, t("Notebook"));
    return { id: createPage({ parentId: parentId ? Number(parentId) : null, title, icon: "📓", content: doc }) };
  });
}

/** Your answer to a question a running cell put: "page" (allow for this page), "always" (every page) or "deny". The code goes on. */
export async function answerPermissionAction(execId: string, permissionId: string, answer: string) {
  return run(() => ({ answered: answerPermission(String(execId ?? ""), String(permissionId ?? ""), String(answer ?? "")) }));
}

/** Settings → Notebook: an allowed access taken back. */
export async function revokeGrantAction(fd: FormData): Promise<void> {
  revokeGrant(String(fd.get("scope") ?? ""), String(fd.get("key") ?? ""));
  revalidatePath("/settings/notebook");
  redirect(`/settings/notebook?ok=${encodeURIComponent(t("Taken back."))}`);
}

/** Settings → Notebook → Functions: a plugin's functions are granted what they say they need (and nothing more). */
/** Settings → Notebook: make (or renew) the secret of a plugin's webhooks, or switch the webhooks off (no secret = nobody can call). */
export async function webhookSecretAction(fd: FormData): Promise<void> {
  const plugin = String(fd.get("plugin") ?? "");
  const { declaredFunctions } = await import("./functions");
  if (!declaredFunctions().some((f) => f.plugin === plugin && f.webhook)) redirect(`/settings/notebook?ok=${encodeURIComponent(t("No such plugin."))}`);
  const w = await import("./webhooks");
  if (fd.get("off")) w.clearWebhookSecret(plugin);
  else w.renewWebhookSecret(plugin);
  revalidatePath("/settings/notebook");
  redirect(`/settings/notebook?ok=${encodeURIComponent(fd.get("off") ? t("Webhooks switched off.") : t("New webhook secret made."))}`);
}

export async function grantFunctionAction(fd: FormData): Promise<void> {
  const plugin = String(fd.get("plugin") ?? "");
  const { declaredFunctions } = await import("./functions");
  const mine = declaredFunctions().filter((f) => f.plugin === plugin);
  if (!mine.length) redirect(`/settings/notebook?ok=${encodeURIComponent(t("No such plugin."))}`);
  grantNeeds(plugin, mine.flatMap((f) => f.needs));
  revalidatePath("/settings/notebook");
  redirect(`/settings/notebook?ok=${encodeURIComponent(t("Allowed what its functions need."))}`);
}

/** The AI writes (or changes) a code cell's code from a description — in the cell's language, knowing its inputs and Zeff's functions. */
export async function writeCodeAction(language: string, description: string, current: string, inputs: CodeInput[], outputName: string) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const wish = String(description ?? "").trim();
    if (!wish) throw new Error(t("Say in a sentence what the code should do."));
    const { runAi } = await import("@/lib/ai");
    const { codePrompt, cleanCode } = await import("./ai-code");
    const list = (Array.isArray(inputs) ? inputs : []).slice(0, 20).map((i): CodeInput => ({ name: String(i?.name ?? "").slice(0, 120), kind: i?.kind === "database" ? "database" : "table", columns: (Array.isArray(i?.columns) ? i.columns : []).map((c) => String(c).slice(0, 60)).slice(0, 40), sample: (Array.isArray(i?.sample) ? i.sample : []).slice(0, 3).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").slice(0, 40)).slice(0, 40) : [])) }));
    const r = await runAi<{ code?: unknown; note?: unknown }>(
      codePrompt({ language: String(language ?? "python").slice(0, 20), description: wish, current: String(current ?? ""), inputs: list, outputName: String(outputName ?? "").slice(0, 80) }),
      { type: "object", required: ["code"], properties: { code: { type: "string" }, note: { type: "string" } } },
      { task: "notebook-code", timeoutMs: 120000, maxBudgetUsd: 0.3 },
    );
    const code = cleanCode(r.output?.code);
    if (!code) throw new Error(t("The AI gave no code — say it a little differently."));
    return { code, note: String(r.output?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) };
  });
}
