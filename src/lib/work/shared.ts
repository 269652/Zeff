/**
 * The Work tab — todos handed to workers (Claude Code or the Copilot CLI, unattended): the parts
 * pages and the server share (client-safe: no DB access here).
 */
import { actionHref } from "@/plugins/actions/catalog";
import { TODO_KINDS, TODO_OPS_SCHEMA, type TodoKind, type TodoView } from "@/lib/boards/shared";
import { type T, translator } from "@/lib/i18n/shared";

/** code: do the work in the ticket's repo · draft: write the message a todo asks for · send: post a drafted message. */
/** …mr: open the merge request for a pushed branch; ops: run a todo's operations (both Zeff itself, no AI). */
export type WorkMode = "code" | "draft" | "send" | "mr" | "ops" | "instruct";
export const WORK_MODE_LABELS: Record<WorkMode, string> = { code: "implement", draft: "write the draft", send: "post to Jira", mr: "open the MR", ops: "run", instruct: "follow your instruction" };
export const workModeLabels = (t: T): Record<WorkMode, string> => ({
  code: t("implement"),
  draft: t("write the draft"),
  send: t("post to Jira"),
  mr: t("open the MR"),
  ops: t("run"),
  instruct: t("follow your instruction"),
});
export function parseMrTarget(target: string | null | undefined): { project: string; source: string; target: string } | null {
  const m = /^gitlab-mr:([^|]+)\|([^|]+)\|([^|]+)$/.exec(target ?? "");
  return m ? { project: m[1], source: m[2], target: m[3] } : null;
}

export type WorkStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "interrupted",
};
export const workStatusLabels = (t: T): Record<WorkStatus, string> => ({
  queued: t("queued"),
  running: t("running"),
  done: t("done"),
  failed: t("failed"),
  cancelled: t("stopped"),
  interrupted: t("interrupted"),
});
export const isActive = (s: WorkStatus) => s === "queued" || s === "running";

/** A work run's reference: "W-12". */
export const workRef = (id: number) => `W-${id}`;

/** Todos that are messages (a reply, a comment, a ticket change, a question), not work in a repo. */
export const COMMS_KINDS: readonly TodoKind[] = ["reply", "comment", "update", "clarify"];

export type Channel = "jira" | "teams" | "gitlab";
export const CHANNEL_LABELS: Record<Channel, string> = { jira: "Jira", teams: "Teams", gitlab: "GitLab" };

/**
 * What handing a todo to a worker does — or why it can't: done already, someone else's move, a
 * deploy (yours to do), a drafted message for Teams or GitLab (no worker can post there: copy
 * the draft and send it yourself).
 */
export function workModeOf(
  todo: Pick<TodoView, "kind" | "owner" | "status" | "draft" | "channel" | "target" | "ops">,
  t: T = translator("en"),
): { mode: WorkMode; why?: undefined } | { mode: null; why: string } {
  if (todo.status !== "open") return { mode: null, why: t("Done already.") };
  // Its operations Zeff can run while you wait (asking them, assigning it) — a merge only once approved.
  // (Not the ones that open in your browser — a mail draft, an appointment: those are links.)
  const zeff = todo.ops.filter((o) => !actionHref(o));
  if (zeff.length && !(todo.owner === "other" && zeff.some((o) => o.type === "gitlab-merge"))) return { mode: "ops" };
  if (todo.owner === "other") return { mode: null, why: t("Waiting for someone else — nothing for a worker.") };
  if (todo.kind === "deploy") return { mode: null, why: t("Deploys are yours to do.") };
  if (todo.kind === "merge") {
    if (parseMrTarget(todo.target)) return { mode: "mr" };
    return { mode: null, why: t("Which branch into which isn't known — open the merge request yourself.") };
  }
  if (!COMMS_KINDS.includes(todo.kind)) return { mode: "code" };
  if (!todo.draft?.trim()) return { mode: "draft" };
  if (todo.channel === "teams") {
    const channel = CHANNEL_LABELS[todo.channel];
    return { mode: null, why: t("No worker can post in {channel} — copy the draft and send it yourself.", { channel }) };
  }
  return { mode: "send" };
}

/** What a worker answers at the end (see WORK_RESULT_SCHEMA). */
export type WorkFollowUp = { kind: TodoKind; text: string; channel?: Channel | "none"; target?: string; draft?: string; ops?: unknown[] };
export type WorkResult = {
  outcome: "done" | "partial" | "blocked";
  summary: string;
  entry: string;
  completedTodos: number[];
  followUps: WorkFollowUp[];
  changes?: string[];
  checks?: string[];
  /** Draft mode: the message, and where it goes. */
  draft?: string;
  channel?: Channel | "none";
  target?: string;
};

/** The shape a worker's answer must have (Claude's --json-schema; Copilot gets it in the prompt). */
export const WORK_RESULT_SCHEMA = {
  type: "object",
  required: ["outcome", "summary", "entry", "completedTodos", "followUps"],
  properties: {
    outcome: {
      type: "string",
      enum: ["done", "partial", "blocked"],
      description: "done: der Auftrag ist erledigt · partial: teilweise · blocked: ging nicht (Rückfrage, Umgebung fehlt …).",
    },
    summary: {
      type: "string",
      description: "Was du getan hast, in Markdown, knapp: Erledigt (je Punkt womit geprüft), Offen, Tests/Checks, Doku — und wo die Änderungen liegen (Branch, Commits).",
    },
    entry: { type: "string", description: "Eine Zeile (< 80 Zeichen) für die Zeitbuchung: was gemacht wurde, ohne Ticket-Key." },
    completedTodos: {
      type: "array",
      items: { type: "integer" },
      description: "Die Nummern der Todos, die jetzt nachweislich erledigt sind (der Auftrag und andere offene dieses Tickets, die du mit erledigt hast).",
    },
    followUps: {
      type: "array",
      description:
        "Was danach zu tun ist — vor allem alles, was nach außen geht: Antworten in Teams, Kommentare und Status-Änderungen in Jira, Antworten in GitLab. Jeweils mit fertigem Entwurf.",
      items: {
        type: "object",
        required: ["kind", "text"],
        properties: {
          kind: { type: "string", enum: [...TODO_KINDS] },
          text: { type: "string", description: "Ein Satz, Verb zuerst, prüfbar." },
          channel: { type: "string", enum: ["jira", "teams", "gitlab", "none"], description: "Wohin es geht (none: Arbeit, keine Nachricht)." },
          target: { type: "string", description: "jira: der Ticket-Key · teams: teams:<Kennung> der Nachricht, auf die geantwortet wird · gitlab: gitlab:note:<id>." },
          draft: { type: "string", description: "Der fertige Text (Kommentar, Antwort) oder die Änderung (z. B. „Status → Testing, zuweisen an Julia Freidank“)." },
          ops: TODO_OPS_SCHEMA,
        },
      },
    },
    changes: { type: "array", items: { type: "string" }, description: "Geänderte Dateien und Commits." },
    checks: { type: "array", items: { type: "string" }, description: "Ausgeführte Tests und Prüfungen, je mit Ergebnis." },
    draft: { type: "string", description: "Nur beim Entwurf-Auftrag: die fertige Nachricht." },
    channel: { type: "string", enum: ["jira", "teams", "gitlab", "none"], description: "Nur beim Entwurf-Auftrag: wohin die Nachricht geht." },
    target: { type: "string", description: "Nur beim Entwurf-Auftrag: Ticket-Key, teams:<Kennung> oder gitlab:note:<id>." },
  },
} as const;

/** One line of a run's log, as the Work tab shows it. */
export type WorkLogLine =
  /** Session, model, folder, permission mode. */
  | { k: "start"; text: string; /** The model that answers, as the CLI reports it. */ model?: string }
  /** The worker's own words. */
  | { k: "say"; text: string }
  /** A message of yours while it was working (the first message is the run's prompt, shown as the question). */
  | { k: "you"; text: string }
  /** A tool call, in short ("Bash", "npm test"). */
  | { k: "tool"; tool: string; text: string }
  /** A tool's result (errors and short ones). */
  | { k: "out"; text: string; error?: boolean }
  /** Refused by the permission mode. */
  | { k: "deny"; text: string }
  | { k: "end"; text: string; ok: boolean }
  /** Plain output (Copilot, errors). */
  | { k: "raw"; text: string };

/** A run as the pages show it. */
export type WorkRunView = {
  /** A live (interactive) session: its mode, whether it works, what it asks of you. */
  live: import("@/plugins/copilot-cli/live-state").LiveView | null;
  id: number;
  ref: string;
  ticket: string;
  todoId: number;
  mode: WorkMode;
  /** zeff: Zeff did it itself (a GitLab reply posted through the automation Chrome); agent: an agent outside Zeff (its name: model), through Zeff's MCP. */
  provider: "claude" | "copilot" | "zeff" | "agent";
  model: string | null;
  permissionMode: string | null;
  status: WorkStatus;
  repo: string | null;
  cwd: string | null;
  branch: string | null;
  base: string | null;
  sessionId: string | null;
  result: WorkResult | null;
  outcome: WorkResult["outcome"] | null;
  summary: string | null;
  entryLine: string | null;
  gitSummary: string | null;
  error: string | null;
  costUsd: number | null;
  durationMs: number | null;
  turns: number | null;
  denials: number | null;
  entryId: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Claude Code's permission modes a worker can run in (with --print nobody answers a prompt: what would ask is refused). */
export const PERMISSION_MODES = ["auto", "acceptEdits", "bypassPermissions"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_MODE_INFO: Record<PermissionMode, { label: string; hint: string }> = {
  auto: { label: "Auto (recommended)", hint: "Claude's classifier approves or refuses each action — risky ones (pushing, deleting, reaching out) are refused." },
  acceptEdits: { label: "Edits only", hint: "File edits yes; commands only those you already allowed in Claude Code — tests won't run otherwise." },
  bypassPermissions: { label: "Allow everything", hint: "No checks at all. Only if you fully trust the workers." },
};
export const permissionModeInfo = (t: T): Record<PermissionMode, { label: string; hint: string }> => ({
  auto: {
    label: t("Auto (recommended)"),
    hint: t("Claude's classifier approves or refuses each action — risky ones (pushing, deleting, reaching out) are refused."),
  },
  acceptEdits: {
    label: t("Edits only"),
    hint: t("File edits yes; commands only those you already allowed in Claude Code — tests won't run otherwise."),
  },
  bypassPermissions: { label: t("Allow everything"), hint: t("No checks at all. Only if you fully trust the workers.") },
});

export type WorkIsolation = "worktree" | "checkout";

/** How Copilot workers run: a live session asking you (interactive), one allowed everything (autopilot), or a one-shot run (headless). */
export const COPILOT_MODES = ["interactive", "autopilot", "headless"] as const;
export type CopilotMode = (typeof COPILOT_MODES)[number];
export const COPILOT_MODE_LABELS: Record<CopilotMode, string> = {
  interactive: "Interactive — asks you for permission",
  autopilot: "Autopilot — allows everything, runs through",
  headless: "No questions (as before) — refuses what isn't allowed",
};
export const copilotModeLabels = (t: T): Record<CopilotMode, string> => ({
  interactive: t("Interactive — asks you for permission"),
  autopilot: t("Autopilot — allows everything, runs through"),
  headless: t("No questions (as before) — refuses what isn't allowed"),
});

export type WorkSettingsView = {
  parallel: number;
  copilotMode: CopilotMode;
  permissionMode: PermissionMode;
  isolation: WorkIsolation;
  model: string;
  instructions: string;
  /** What a todo's label copies for an agent: for code todos, for the others ($todo.id …). */
  agentInstructions: { code: string; other: string };
};

/** "1:05 min", "42 s". */
export function duration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m}:${String(s % 60).padStart(2, "0")} min`;
}
