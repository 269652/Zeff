import { AGENT_INSTRUCTION_DEFAULTS } from "@/lib/todos/shared";
import { promptText } from "@/lib/prompts";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { liveView } from "@/plugins/copilot-cli/live-state";
import { liveSessionView } from "./live-driver";
import { getPref, setPref } from "@/lib/prefs";
import type { WorkRun } from "@/db/schema";
import { getAppSettings, updateAppSettings } from "@/lib/ai";
import { CLAUDE_SESSION_DEFAULTS, COPILOT_MODES, EFFORTS, isClaudeMode, PERMISSION_MODES, workRef, type ClaudeSessionSettings, type CopilotMode, type PermissionMode, type WorkMode, type WorkResult, type WorkRunView, type WorkSettingsView, type WorkStatus } from "./shared";

const { workRuns } = schema;

const parse = <T>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function getWorkSettings(): WorkSettingsView {
  const s = getAppSettings();
  return {
    parallel: Math.min(8, Math.max(1, Math.round(s.workParallel) || 1)),
    permissionMode: (PERMISSION_MODES as readonly string[]).includes(s.workPermissionMode) ? (s.workPermissionMode as PermissionMode) : "auto",
    isolation: s.workIsolation === "checkout" ? "checkout" : "worktree",
    copilotMode: (COPILOT_MODES as readonly string[]).includes(s.workCopilotMode) ? (s.workCopilotMode as CopilotMode) : "interactive",
    model: s.workModel,
    instructions: promptText("work-rules", "", s.workInstructions),
    agentInstructions: { code: s.agentInstructionCode || AGENT_INSTRUCTION_DEFAULTS.code, other: s.agentInstructionOther || AGENT_INSTRUCTION_DEFAULTS.other },
  };
}

export function updateWorkSettings(patch: Partial<WorkSettingsView>): WorkSettingsView {
  updateAppSettings({
    ...(patch.parallel !== undefined ? { workParallel: Math.min(8, Math.max(1, Math.round(patch.parallel))) } : {}),
    ...(patch.permissionMode !== undefined ? { workPermissionMode: patch.permissionMode } : {}),
    ...(patch.isolation !== undefined ? { workIsolation: patch.isolation } : {}),
    ...(patch.copilotMode !== undefined ? { workCopilotMode: patch.copilotMode } : {}),
    ...(patch.model !== undefined ? { workModel: patch.model.trim() } : {}),
    ...(patch.instructions !== undefined ? { workInstructions: patch.instructions.trim().slice(0, 4000) } : {}),
    ...(patch.agentInstructions !== undefined
      ? {
          agentInstructionCode: patch.agentInstructions.code.trim().slice(0, 1000) || AGENT_INSTRUCTION_DEFAULTS.code,
          agentInstructionOther: patch.agentInstructions.other.trim().slice(0, 1000) || AGENT_INSTRUCTION_DEFAULTS.other,
        }
      : {}),
  });
  return getWorkSettings();
}

/** Live Claude sessions' settings (Code settings → Claude sessions). */
export function claudeSessionSettings(): ClaudeSessionSettings {
  const p = { ...CLAUDE_SESSION_DEFAULTS, ...getPref<Partial<ClaudeSessionSettings>>("workClaude", {}) };
  return {
    live: p.live !== false,
    mode: isClaudeMode(p.mode) ? p.mode : CLAUDE_SESSION_DEFAULTS.mode,
    autoMode: isClaudeMode(p.autoMode) ? p.autoMode : CLAUDE_SESSION_DEFAULTS.autoMode,
    effort: (EFFORTS as readonly string[]).includes(p.effort) ? p.effort : "",
    allowBypass: !!p.allowBypass,
    askTimeoutMin: Math.min(1440, Math.max(0, Math.round(Number(p.askTimeoutMin)) || 0)),
  };
}

export function updateClaudeSessionSettings(patch: Partial<ClaudeSessionSettings>): ClaudeSessionSettings {
  setPref("workClaude", { ...claudeSessionSettings(), ...patch });
  const s = claudeSessionSettings();
  // Bypass taken back: it's no longer a mode new sessions start in.
  if (!s.allowBypass && (s.mode === "bypassPermissions" || s.autoMode === "bypassPermissions")) {
    setPref("workClaude", { ...s, mode: s.mode === "bypassPermissions" ? "default" : s.mode, autoMode: s.autoMode === "bypassPermissions" ? "auto" : s.autoMode });
  }
  emitChange("work");
  return claudeSessionSettings();
}

const STATUSES: WorkStatus[] = ["queued", "running", "done", "failed", "cancelled", "interrupted"];

export function toRunView(r: WorkRun): WorkRunView {
  return {
    id: r.id,
    ref: workRef(r.id),
    ticket: r.ticket,
    todoId: r.todoId,
    mode: (["code", "draft", "send", "mr", "ops", "instruct"].includes(r.mode) ? r.mode : "code") as WorkMode,
    live: liveView(r.id) ?? liveSessionView(r.id)?.live ?? null,
    session: liveSessionView(r.id)?.session ?? null,
    provider: r.provider === "copilot" || r.provider === "codex" || r.provider === "zeff" || r.provider === "agent" ? r.provider : "claude",
    model: r.model,
    permissionMode: r.permissionMode,
    status: (STATUSES as string[]).includes(r.status) ? (r.status as WorkStatus) : "failed",
    repo: r.repo,
    cwd: r.cwd,
    branch: r.branch,
    base: r.base,
    sessionId: r.sessionId,
    result: parse<WorkResult | null>(r.result, null),
    outcome: r.outcome === "done" || r.outcome === "partial" || r.outcome === "blocked" ? r.outcome : null,
    summary: r.summary,
    entryLine: r.entryLine,
    gitSummary: r.gitSummary,
    error: r.error,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    turns: r.turns,
    denials: r.denials,
    entryId: r.entryId,
    queuedAt: r.queuedAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

/** A new run, queued. With sessionId and cwd it goes on with an earlier run's session, where that one worked. */
export function createRun(
  values: Pick<WorkRun, "ticket" | "todoId" | "mode" | "provider" | "model" | "permissionMode" | "repo" | "prompt"> &
    Partial<Pick<WorkRun, "sessionId" | "cwd" | "branch" | "base" | "baseSha" | "workspace" | "afterRun">>,
): WorkRun {
  emitChange("work");
  return getDb()
    .insert(workRuns)
    .values({ ...values, status: "queued", queuedAt: new Date().toISOString() })
    .returning()
    .get();
}

export function updateRun(id: number, patch: Partial<Omit<WorkRun, "id">>): WorkRun | undefined {
  emitChange("work");
  return getDb().update(workRuns).set(patch).where(eq(workRuns.id, id)).returning().get();
}

/** A failed run's error, seen (or dealt with by a new run): no longer shown on its todo. */
export function markRunErrorSeen(id: number): void {
  updateRun(id, { errorSeenAt: new Date().toISOString() });
}

export function getRun(id: number): WorkRun | undefined {
  return getDb().select().from(workRuns).where(eq(workRuns.id, id)).get();
}

/** Runs in these states, oldest first (the queue's order). */
export function runsByStatus(statuses: WorkStatus[]): WorkRun[] {
  return getDb().select().from(workRuns).where(inArray(workRuns.status, statuses)).orderBy(asc(workRuns.id)).all();
}

/** The runs on these todos, newest first, by todo. */
export function runsForTodos(todoIds: number[]): Map<number, WorkRunView[]> {
  const out = new Map<number, WorkRunView[]>();
  if (!todoIds.length) return out;
  for (const r of getDb().select().from(workRuns).where(inArray(workRuns.todoId, [...new Set(todoIds)])).orderBy(desc(workRuns.id)).all()) {
    const list = out.get(r.todoId) ?? [];
    list.push(toRunView(r));
    out.set(r.todoId, list);
  }
  return out;
}

/** The newest runs (all of them, for the history). */
export function recentRuns(limit = 50): WorkRunView[] {
  return getDb().select().from(workRuns).orderBy(desc(workRuns.id)).limit(limit).all().map(toRunView);
}
