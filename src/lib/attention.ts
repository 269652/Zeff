import { automationEnv } from "@/plugins/drivers";
import { execFile } from "node:child_process";
import path from "node:path";
import { emitChange } from "@/lib/events";
import { integrationServer } from "@/lib/integrations/server";
import { t } from "@/lib/i18n/server";

/** The systems Zeff reaches through the automation Chrome (or a login), each with where you sign in. */
export type CoreServiceId = "teams" | "outlook" | "gmail" | "whatsapp" | "signal" | "keep" | "gcalendar" | "gitlab" | "jira";
/** A service: one of Zeff's own, or one a mounted integration signs in to (its `service`). */
export type ServiceId = CoreServiceId | (string & {});

export const SERVICE_LABELS: Record<CoreServiceId, string> = { teams: "Teams", outlook: "Outlook", gmail: "Gmail", whatsapp: "WhatsApp", signal: "Signal", keep: "Google Keep", gcalendar: "Google Calendar", gitlab: "GitLab", jira: "Jira" };

/** A service's name — Zeff's own, else the mounted integration's; undefined when there is no such service. */
export const serviceLabel = (id: string): string | undefined => (SERVICE_LABELS as Record<string, string>)[id] ?? integrationServer(id)?.service?.label;

/** A sign-in page some service sends you to (Microsoft's, GitLab's, …): tabs on it count as that service's. */
const SIGN_IN_PAGES = "accounts\\.google\\.com|login\\.microsoftonline\\.com|login\\.live\\.com|login\\.windows\\.net|/users/sign_in|/login";

async function serviceUrl(id: ServiceId): Promise<string | null> {
  // The mounted integrations' say where their sign-in page is.
  const own = integrationServer(id)?.service?.loginUrl;
  if (own) return own;
  if (id === "teams") return "https://teams.microsoft.com/v2/";
  if (id === "outlook") return "https://outlook.office.com/mail/inbox";
  if (id === "gmail") return "https://mail.google.com/mail/u/0/#inbox";
  if (id === "whatsapp") return "https://web.whatsapp.com/";
  if (id === "keep") return `https://keep.google.com/u/${(await import("@/plugins/keep/store")).keepSettings().account}/`;
  if (id === "gcalendar") return `https://calendar.google.com/calendar/u/${(await import("@/plugins/google-calendar/sync")).googleCalendarSettings().account}/r`;
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
  // Signal has no web app: Signal Desktop started (with its debug port) — you link it there.
  if (id === "signal") return (await import("@/plugins/signal/open")).openSignal();
  const url = await serviceUrl(id);
  if (!url) return { ok: false, message: t("No address is set for {service}.", { service: serviceLabel(id) }) };
  return openInAutomationChrome(url, serviceLabel(id) ?? id);
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
      ? {
          ok: true,
          message: r.newTab
            ? t("{label} is in front in the automation Chrome (new tab) — sign in there.", { label })
            : t("{label} is in front in the automation Chrome — sign in there.", { label }),
        }
      : { ok: false, message: r.error ?? t("Didn't work.") };
  } catch {
    return { ok: false, message: out.slice(0, 300) || t("Chrome didn't answer.") };
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
    title: t("{service}: sign-in needed", { service: serviceLabel(service) ?? service }),
    body: t("{detail} — sign in in the automation Chrome (Zeff never types credentials), then try again.", { detail: detail.slice(0, 200) }),
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
    .filter((todo) => todo.needsInput)
    .map((todo): Attention => ({
      key: `question:${todo.id}`,
      kind: "question",
      title: t("{ref} is waiting for your answer", { ref: todo.ref }),
      body: todo.needsInput!,
      at: todo.updatedAt,
      href: `/t/${todo.id}`,
    }));
  // Live Copilot sessions waiting on you: a permission it asks for, or its turn over without a result.
  const { lives } = await import("@/plugins/copilot-cli/live-state");
  const { workRef } = await import("@/lib/work/shared");
  const live = [...lives.values()].flatMap((l): Attention[] =>
    l.view.permission
      ? [{ key: `permission:${l.runId}:${l.view.permission.title}`, kind: "question", title: t("{ref} asks for permission", { ref: workRef(l.runId) }), body: `${l.view.permission.title}${l.view.permission.detail ? ` — ${l.view.permission.detail}` : ""}`, at: new Date().toISOString(), href: `/work?run=${l.runId}` }]
      : l.view.waiting
        ? [{ key: `waiting:${l.runId}`, kind: "question", title: t("{ref} is waiting for your answer", { ref: workRef(l.runId) }), body: l.view.waiting.slice(-300), at: new Date().toISOString(), href: `/work?run=${l.runId}` }]
        : [],
  );
  // Live Claude sessions: what they ask (a permission, a plan, a question), and a finished turn waiting for your next message.
  // Live sessions (any provider's): what they ask, and a finished turn waiting for your next message.
  const { liveDrivers, askTitle } = await import("@/lib/work/live-driver");
  const claude = liveDrivers().flatMap((d) => d.runIds()).flatMap((runId): Attention[] => {
    const v = liveDrivers()
      .find((d) => d.runIds().includes(runId))
      ?.view(runId);
    if (!v) return [];
    const ask = v.session.asks[0];
    if (ask) return [{ key: `claude-ask:${runId}:${ask.requestId}`, kind: "question", title: `${workRef(runId)} asks you`, body: `${askTitle(ask, t)}${v.live.permission?.detail ? ` — ${v.live.permission.detail}` : ""}`, at: ask.at, href: `/work?run=${runId}` }];
    if (v.live.waiting !== null && v.session.conversation) return [{ key: `session-turn:${runId}:${(v.live.waiting ?? "").length}:${(v.live.waiting ?? "").slice(-40)}`, kind: "question", title: `${workRef(runId)} is waiting for you`, body: (v.live.waiting || "Its turn is done.").slice(-300), at: new Date().toISOString(), href: `/work?run=${runId}` }];
    return [];
  });
  // Sign-ins only for what's installed (an uninstalled plugin's request is moot).
  const { serviceAvailable } = await import("@/plugins/state");
  return [...[...store.values()].filter((a) => !a.service || serviceAvailable(a.service)), ...questions, ...live, ...claude];
}
