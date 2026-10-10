import { automationEnv } from "@/plugins/drivers";
import { execFile } from "node:child_process";
import path from "node:path";
import { emitChange } from "@/lib/events";

/** The systems Zeff reaches through the automation Chrome (or a login), each with where you sign in. */
export type ServiceId = "teams" | "outlook" | "gmail" | "whatsapp" | "keep" | "gitlab" | "jira" | "chrono" | "punch";

export const SERVICE_LABELS: Record<ServiceId, string> = { teams: "Teams", outlook: "Outlook", gmail: "Gmail", whatsapp: "WhatsApp", keep: "Google Keep", gitlab: "GitLab", jira: "Jira", chrono: "Chrono", punch: "Punch" };

/** A sign-in page some service sends you to (Microsoft's, GitLab's, …): tabs on it count as that service's. */
const SIGN_IN_PAGES = "accounts\\.google\\.com|login\\.microsoftonline\\.com|login\\.live\\.com|login\\.windows\\.net|/users/sign_in|/login";

async function serviceUrl(id: ServiceId): Promise<string | null> {
  if (id === "teams") return "https://teams.microsoft.com/v2/";
  if (id === "outlook") return "https://outlook.office.com/mail/inbox";
  if (id === "gmail") return "https://mail.google.com/mail/u/0/#inbox";
  if (id === "whatsapp") return "https://web.whatsapp.com/";
  if (id === "keep") return `https://keep.google.com/u/${(await import("@/plugins/keep/store")).keepSettings().account}/`;
  if (id === "chrono") return "https://chrono.example.ai/app/timesheet";
  if (id === "punch") return "https://ac.punch24.de/punch/index.jsp";
  if (id === "gitlab") return `${(await import("@/lib/gitlab/store")).getGitlabSettings().baseUrl.replace(/\/+$/, "")}/`;
  const { getJiraSyncConfig } = await import("@/lib/jira/sync");
  const base = getJiraSyncConfig().baseUrl;
  return base ? `${base.replace(/\/+$/, "")}/` : null;
}

/**
 * A service's page in the automation Chrome, at the front — the tab it has (or the sign-in page
 * it was sent to), else a new one; Chrome started if it isn't running. Signing in is yours: Zeff
 * never types anything there.
 */
export async function openServiceLogin(id: ServiceId): Promise<{ ok: boolean; message: string }> {
  const url = await serviceUrl(id);
  if (!url) return { ok: false, message: `Für ${SERVICE_LABELS[id]} ist keine Adresse eingestellt.` };
  return openInAutomationChrome(url, SERVICE_LABELS[id]);
}

/** A page in the automation Chrome, at the front (its tab if one shows it, else a new one) — Chrome started if needed. */
export async function openInAutomationChrome(url: string, label: string): Promise<{ ok: boolean; message: string }> {
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "chrome-open.mjs");
  const out = await new Promise<string>((resolve) =>
    execFile(process.execPath, [script, url, SIGN_IN_PAGES], { timeout: 90000, windowsHide: true, env: { ...process.env, ...automationEnv() } }, (_err, stdout) => resolve(String(stdout ?? ""))),
  );
  try {
    const r = JSON.parse(out) as { ok: boolean; newTab?: boolean; error?: string };
    return r.ok
      ? { ok: true, message: `${label} ist im Automation-Chrome vorne${r.newTab ? " (neuer Tab)" : ""} — melde dich dort an.` }
      : { ok: false, message: r.error ?? "Ging nicht." };
  } catch {
    return { ok: false, message: out.slice(0, 300) || "Chrome hat nicht geantwortet." };
  }
}

/** Something that needs you: a service to sign in to, an agent's question. */
export type Attention = {
  key: string;
  kind: "login" | "question";
  title: string;
  body: string;
  at: string;
  /** login: which service (its sign-in can be opened, its sync run again). */
  service?: ServiceId;
  /** Where to answer (a todo). */
  href?: string;
};

const state = globalThis as { __zeffAttention?: Map<string, Attention> };
const store = (state.__zeffAttention ??= new Map());

/** A sync's error that means: sign in (to that service) first. */
export const needsSignIn = (message: string) => /sign(ed)?[- ]?in|anmeld|not signed|unauthori[sz]ed|\b401\b|session expired|login/i.test(message);

/** A service wants you to sign in — shown (and pinged) till it's fine again. */
export function raiseLogin(service: ServiceId, detail: string): void {
  const key = `login:${service}`;
  if (store.has(key)) return;
  store.set(key, {
    key,
    kind: "login",
    service,
    title: `${SERVICE_LABELS[service]} braucht deine Anmeldung`,
    body: `${detail.slice(0, 200)} — melde dich im Automation-Chrome an (Zeff gibt keine Zugangsdaten ein), dann noch einmal.`,
    at: new Date().toISOString(),
  });
  emitChange("attention");
}

/** A service works again (or you put it off): its request goes. */
export function clearAttention(key: string): void {
  if (store.delete(key)) emitChange("attention");
}

/** What needs you now: sign-ins, and the questions agents wait on (todos with ❗). */
export async function listAttention(): Promise<Attention[]> {
  const { listTodos } = await import("@/lib/boards/store");
  const questions = listTodos({ status: "open" })
    .filter((t) => t.needsInput)
    .map((t): Attention => ({ key: `question:${t.id}`, kind: "question", title: `${t.ref} wartet auf dich`, body: t.needsInput!, at: t.updatedAt, href: `/t/${t.id}` }));
  // Live Copilot sessions waiting on you: a permission it asks for, or its turn over without a result.
  const { lives } = await import("@/plugins/copilot-cli/live-state");
  const { workRef } = await import("@/lib/work/shared");
  const live = [...lives.values()].flatMap((l): Attention[] =>
    l.view.permission
      ? [{ key: `permission:${l.runId}:${l.view.permission.title}`, kind: "question", title: `${workRef(l.runId)} fragt um Erlaubnis`, body: `${l.view.permission.title}${l.view.permission.detail ? ` — ${l.view.permission.detail}` : ""}`, at: new Date().toISOString(), href: `/work#w-${l.runId}` }]
      : l.view.waiting
        ? [{ key: `waiting:${l.runId}`, kind: "question", title: `${workRef(l.runId)} wartet auf dich`, body: l.view.waiting.slice(-300), at: new Date().toISOString(), href: `/work#w-${l.runId}` }]
        : [],
  );
  // Sign-ins only for what's installed (an uninstalled plugin's request is moot).
  const { serviceAvailable } = await import("@/plugins/state");
  return [...[...store.values()].filter((a) => !a.service || serviceAvailable(a.service)), ...questions, ...live];
}
