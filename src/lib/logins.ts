import { currentAccountId, accountChrome } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { automationEnv, automationUp, driverPath, type DriverId } from "@/plugins/drivers";
import { PLUGINS } from "@/plugins/catalog";
import { installedPlugins, stepAvailable } from "@/plugins/state";
import { listAttention, SERVICE_LABELS, type ServiceId } from "./attention";
import { syncOverview } from "./sync/registry";
import type { SyncKey } from "./sync/shared";

/** ok: signed in · login: wants you to sign in · closed: its page isn't open · chrome: the automation Chrome isn't running · unknown: not known yet. */
export type LoginState = "ok" | "login" | "closed" | "chrome" | "unknown";

export type LoginView = {
  service: ServiceId;
  label: string;
  /** The installed plugins that sign in there. */
  plugins: string[];
  state: LoginState;
  detail: string;
  /** Where that comes from: a check just now, a sign-in request, the last sync. */
  source: "check" | "request" | "sync" | null;
  /** ISO. */
  at: string | null;
  /** It has a check of its own (its driver's status). */
  checkable: boolean;
};

/** The driver and its status tool, per service — GitLab and Jira have none (their last sync tells). */
const STATUS_TOOL: Partial<Record<ServiceId, [DriverId, string]>> = {
  teams: ["teams", "teams_status"],
  outlook: ["outlook", "outlook_status"],
  gmail: ["gmail", "gmail_status"],
  whatsapp: ["whatsapp", "whatsapp_status"],
  signal: ["signal", "signal_status"],
  keep: ["keep", "keep_status"],
  gcalendar: ["google-calendar", "gcal_status"],
  chrono: ["chrono", "chrono_status"],
  punch: ["punch", "punch_status"],
};

/** The sync whose last run tells whether the sign-in still works. */
const stepOf = (s: ServiceId): SyncKey => (s === "outlook" ? (stepAvailable("mail") ? "mail" : "calendar") : s === "gmail" ? "mail" : s);

/** The last checks, per account and service (they live as long as the server). */
const store = globalThis as { __zeffLoginChecks?: Map<string, { state: LoginState; detail: string; at: string }> };
const checks = () => (store.__zeffLoginChecks ??= new Map());

/** A status tool's answer (JSON from Gmail's and WhatsApp's, words from the others') as a state. */
function classify(out: unknown): { state: LoginState; detail: string } {
  if (out && typeof out === "object") {
    const o = out as { chrome?: boolean; open?: boolean; signedIn?: boolean; linked?: boolean; state?: string; message?: string; drift?: { ok: boolean; summary: string } };
    if (o.chrome === false) return { state: "chrome", detail: o.message ?? t("The automation Chrome isn't running.") };
    // WhatsApp / Signal: signed in, but the app no longer looks like the driver expects (an update) — told before a sync breaks on it.
    if ((o.signedIn || o.linked) && o.drift) return { state: "ok", detail: `${t("Signed in.")} ${o.drift.summary}` };
    if (o.signedIn || o.linked) return { state: "ok", detail: t("Signed in.") };
    if (o.open === false) return { state: "closed", detail: t("Not open in the automation Chrome — “Sign in” opens the page.") };
    return { state: "login", detail: o.state === "link" ? t("Not linked — scan the QR code with your phone.") : t("Not signed in.") };
  }
  const text = String(out ?? "");
  if (text.trim().startsWith("{")) {
    try {
      return classify(JSON.parse(text));
    } catch {
      // words, then
    }
  }
  if (/cannot reach chrome|no window open|isn't running|ECONNREFUSED/i.test(text)) return { state: "chrome", detail: text };
  if (/not signed in|sign in|anmeld|login/i.test(text) && !/^connected\.[^]*signed in/i.test(text)) return { state: "login", detail: text };
  if (/^connected\./i.test(text)) return { state: "ok", detail: text };
  if (/isn't open|not open|no .* tab/i.test(text)) return { state: "closed", detail: text };
  return { state: "unknown", detail: text };
}

async function chromeUp(): Promise<boolean> {
  return automationUp(undefined, 2500);
}

/** Ask a service's driver whether it's signed in — read-only: no tab opened, Chrome not started. */
export async function checkLogin(service: ServiceId): Promise<{ state: LoginState; detail: string }> {
  const tool = STATUS_TOOL[service];
  if (!tool) return { state: "unknown", detail: t("No check of its own — the last sync tells.") };
  let r: { state: LoginState; detail: string };
  // Signal Desktop isn't in the automation Chrome: its driver tells itself (running, its port, linked).
  if (service !== "signal" && !(await chromeUp())) r = { state: "chrome", detail: t("The automation Chrome isn't running — “Sign in” starts it.") };
  else {
    try {
      const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
      const out = await runStdioSession(
        // (Punch's driver gets its address and login too — its status check doesn't sign anyone in.)
        { command: process.execPath, args: [driverPath(tool[0])], env: { ...automationEnv(), ...(service === "punch" ? (await import("@/plugins/punch/login")).punchLoginEnv() : {}) }, label: `${SERVICE_LABELS[service]} status` },
        async (call) => resultToPayload(await call(tool[1], {})),
        45000,
      );
      r = classify(out);
    } catch (e) {
      r = classify(errorMessage(e));
    }
  }
  checks().set(`${currentAccountId()}:${service}`, { ...r, at: new Date().toISOString() });
  return r;
}

/** The services the installed plugins sign in to, each with what's known of its sign-in. */
export async function listLogins(): Promise<{ chrome: { endpoint: string; running: boolean }; logins: LoginView[] }> {
  const on = installedPlugins();
  const services = new Map<ServiceId, string[]>();
  for (const p of PLUGINS) if (on.has(p.id)) for (const s of p.services ?? []) if (s in SERVICE_LABELS) services.set(s as ServiceId, [...(services.get(s as ServiceId) ?? []), p.name]);
  const requests = new Map((await listAttention()).filter((a) => a.kind === "login" && a.service).map((a) => [a.service!, a]));
  const steps = new Map(syncOverview().steps.map((s) => [s.key, s]));
  const account = currentAccountId();
  const logins = [...services].map(([service, plugins]): LoginView => {
    const base = { service, label: SERVICE_LABELS[service], plugins, checkable: !!STATUS_TOOL[service] };
    const check = checks().get(`${account}:${service}`);
    const request = requests.get(service);
    const step = steps.get(stepOf(service));
    // The newest of: a check, a sign-in request, the last sync.
    const known = [
      check && { state: check.state, detail: check.detail, source: "check" as const, at: check.at },
      request && { state: "login" as const, detail: request.body, source: "request" as const, at: request.at },
      step?.lastAt &&
        step.lastOk !== null && {
          state: step.lastOk ? ("ok" as const) : ("unknown" as const),
          detail: t("Last sync: {result}", { result: step.lastMessage ?? (step.lastOk ? t("ok") : t("failed")) }),
          source: "sync" as const,
          at: step.lastAt,
        },
    ]
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.at.localeCompare(a.at));
    // A sign-in request stands until a sync or check after it went through.
    const pick = request && !known.some((k) => k.source !== "request" && k.state === "ok" && k.at > request.at) ? known.find((k) => k.source === "request")! : known[0];
    return pick ? { ...base, ...pick } : { ...base, state: "unknown", detail: t("Not checked yet."), source: null, at: null };
  });
  return { chrome: { endpoint: accountChrome().endpoint, running: await chromeUp() }, logins };
}
