"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { num, revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Work: todos handed to workers — its server actions (each answers an ActionState unless it says otherwise). */

/** Hand a todo to a worker (provider: the AI settings' unless given) — queued, started when one is free. */
/**
 * A work session (Work, like Claude Code): your instruction to a worker — on a todo (it goes on
 * where that one is), or as a new todo on a ticket (or none) — in a repo you pick, else the
 * ticket's. Interactive with the Copilot CLI (the Work settings): you talk to it on its page.
 */
/** A new session — or, with continueRunId, your next message in that session's conversation. */
export async function startSessionAction(v: {
  instruction: string;
  ticket?: string;
  todoId?: number;
  repoId?: number;
  provider?: string;
  continueRunId?: number;
  /** Any folder in a git repo (the picker's), and the branch / how to work there. */
  repoPath?: string;
  branch?: string;
  workspace?: string;
  /** A live Claude session's choices: mode, model, effort, isolation, as administrator. */
  session?: import("@/lib/work/shared").SessionOptions;
  /** Pictures and documents pasted into the chat (refs from /api/work/attach): the CLI gets them to read. */
  attachments?: string[];
}): Promise<{ ok: true; runId: number } | { ok: false; error: string }> {
  try {
    const { resolveAttachments } = await import("@/lib/work/attachments");
    const attachments = resolveAttachments(v.attachments);
    // Only files: "see the attachment" is an instruction too.
    const instruction = String(v.instruction ?? "").trim() || (attachments.length ? "Sieh dir die Anhänge an." : "");
    // A todo without words: it's worked on as it is (its brief).
    if (!instruction && v.todoId) {
      const { dispatchTodo } = await import("@/lib/work/runner");
      const run = dispatchTodo(Number(v.todoId));
      revalidatePath("/work");
      return { ok: true, runId: run.id };
    }
    if (!instruction) return { ok: false, error: t("What should the worker do?") };
    const session = await checkSession(v.session);
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    if (v.continueRunId) {
      const { getRun } = await import("@/lib/work/store");
      const prev = getRun(Number(v.continueRunId));
      if (!prev) return { ok: false, error: t("That session doesn't exist any more.") };
      // Still working: the message goes into the running session (it takes it in when idle).
      if (prev.status === "running" && prev.provider === "claude" && !isAiProvider(v.provider)) {
        const { messageRunningSession } = await import("@/lib/work/runner");
        await messageRunningSession(prev.id, instruction);
        revalidatePath("/work");
        return { ok: true, runId: prev.id };
      }
      const run = dispatchTodo(prev.todoId, { instruction, attachments, continueRun: prev.id, provider: isAiProvider(v.provider) ? v.provider : undefined, conversation: true, session });
      revalidatePath("/work");
      return { ok: true, runId: run.id };
    }
    const { addSessionTodo, getTodo } = await import("@/lib/boards/store");
    // On its todo, while it's open; else a new todo (on the ticket, or none).
    const existing = v.todoId ? getTodo(Number(v.todoId)) : undefined;
    const ticket = String(v.ticket ?? existing?.ticket ?? "").trim();
    if (ticket && !/^[A-Z][A-Z0-9]+-\d+$/i.test(ticket)) return { ok: false, error: t("“{ticket}” isn't a ticket.", { ticket }) };
    const todo = existing?.status === "open" ? existing : addSessionTodo({ ticket, text: instruction.split("\n")[0].slice(0, 200) });
    const workspace = v.workspace === "worktree" || v.workspace === "branch" || v.workspace === "checkout" ? v.workspace : undefined;
    const run = dispatchTodo(todo.id, {
      instruction,
      attachments,
      provider: isAiProvider(v.provider) ? v.provider : undefined,
      repoId: v.repoId ? Number(v.repoId) : undefined,
      repoPath: v.repoPath?.trim() || undefined,
      branch: v.branch?.trim() || undefined,
      workspace,
      conversation: true,
      session,
    });
    revalidatePath("/work");
    return { ok: true, runId: run.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Switch the branch a session works on (its worktree, or the repo it works in) - when it is
 * idle, nothing is uncommitted, and the branch isn't checked out elsewhere. The next message
 * goes on from there.
 */
export async function switchSessionBranchAction(runId: number, branch: string): Promise<{ ok: true; branch: string } | { ok: false; error: string }> {
  try {
    const { getRun, runsForTodos, updateRun } = await import("@/lib/work/store");
    const { isActive } = await import("@/lib/work/shared");
    const { switchBranch } = await import("@/lib/work/git");
    const r = getRun(Number(runId));
    if (!r) return { ok: false, error: t("That session doesn't exist any more.") };
    // The conversation's newest run is the session.
    const last = (runsForTodos([r.todoId]).get(r.todoId) ?? [r])[0] ?? r;
    if (isActive(last.status as import("@/lib/work/shared").WorkStatus)) return { ok: false, error: t("The session is working — switch the branch once it has answered.") };
    if (!last.cwd) return { ok: false, error: t("This session has no folder of its own.") };
    const now = switchBranch(last.cwd, String(branch));
    // The conversation's runs all follow (a later message starts from the folder as it is now).
    for (const x of runsForTodos([r.todoId]).get(r.todoId) ?? [r]) if (x.cwd === last.cwd) updateRun(x.id, { branch: now });
    revalidatePath("/work");
    return { ok: true, branch: now };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A session (a todo's conversation) archived — out of the sidebar — or back. */
export async function archiveSessionAction(todoId: number, archived: boolean): Promise<ActionState> {
  try {
    const { setSessionArchived } = await import("@/lib/work/session-admin");
    setSessionArchived(Number(todoId), !!archived);
    revalidatePath("/work");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A session deleted: its runs and logs (not while it works) — its todo stays. */
export async function deleteSessionAction(todoId: number): Promise<ActionState> {
  try {
    const { deleteSession } = await import("@/lib/work/session-admin");
    deleteSession(Number(todoId));
    revalidatePath("/work");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The composer's session choices, checked (a page can send anything). */
async function checkSession(raw: unknown): Promise<import("@/lib/work/shared").SessionOptions | undefined> {
  if (!raw || typeof raw !== "object") return undefined;
  const { EFFORTS } = await import("@/lib/work/shared");
  const o = raw as Record<string, unknown>;
  const out: import("@/lib/work/shared").SessionOptions = {};
  // A mode its provider's driver offers (checked against them when the run is dispatched).
  if (o.permissionMode !== undefined && o.permissionMode !== "") {
    if (typeof o.permissionMode !== "string" || !/^[\w-]{1,40}$/.test(o.permissionMode)) throw new Error(t("Unknown permission mode."));
    out.permissionMode = o.permissionMode;
  }
  if (typeof o.model === "string" && o.model.trim()) {
    if (!/^[\w.[\]-]{1,80}$/.test(o.model.trim())) throw new Error(t("Unknown model."));
    out.model = o.model.trim();
  }
  if (typeof o.effort === "string" && o.effort) {
    if (!(EFFORTS as readonly string[]).includes(o.effort)) throw new Error(t("Unknown effort."));
    out.effort = o.effort as (typeof EFFORTS)[number];
  }
  if (o.elevated === true) {
    const { elevationAvailable } = await import("@/plugins/work-elevated/elevate");
    if (!elevationAvailable()) throw new Error(t("Admin sessions need Windows and the “Admin sessions” plugin (Plugins)."));
    out.elevated = true;
  }
  return out;
}

export async function dispatchWorkAction(todoId: number, provider?: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: provider && isAiProvider(provider) ? provider : undefined });
    revalidateAll();
    return { ok: true, message: run.status === "running" ? t("{run} is running.", { run: run.ref }) : t("{run} waits for a free worker.", { run: run.ref }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A failed run once more, as it was asked for: the same provider, your instruction again (an ✨ run). */
export async function retryRunAction(runId: number): Promise<ActionState> {
  try {
    const { getRun } = await import("@/lib/work/store");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const { isAiProvider } = await import("@/lib/ai/shared");
    const r = getRun(Number(runId));
    if (!r) return { ok: false, error: t("That run doesn't exist any more.") };
    const instruction = r.mode === "instruct" ? /## Deine Anweisung \(vom Nutzer — sie geht vor\)\n([\s\S]*?)(?:\n\n## Dein Auftrag|$)/.exec(r.prompt ?? "")?.[1]?.trim() : undefined;
    if (r.mode === "instruct" && !instruction) return { ok: false, error: t("The instruction can't be found any more — enter it again via ✨.") };
    const run = dispatchTodo(r.todoId, { provider: isAiProvider(r.provider) ? r.provider : undefined, instruction });
    const { markRunErrorSeen } = await import("@/lib/work/store");
    markRunErrorSeen(r.id);
    revalidateAll();
    return { ok: true, message: run.status === "running" ? t("{run} is running.", { run: run.ref }) : t("{run} waits for a free worker.", { run: run.ref }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A failed run's error, seen: no longer shown on its todo. */
export async function dismissRunErrorAction(runId: number): Promise<ActionState> {
  try {
    const { markRunErrorSeen } = await import("@/lib/work/store");
    markRunErrorSeen(Number(runId));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Stop a run, or take it out of the queue. */
export async function cancelWorkAction(runId: number): Promise<ActionState> {
  try {
    const { cancelRun } = await import("@/lib/work/runner");
    cancelRun(Number(runId));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Work tab's settings: workers at once, permission mode, isolation, repos, model, budget, house rules. */
export async function saveWorkSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { PERMISSION_MODES } = await import("@/lib/work/shared");
    const { updateWorkSettings } = await import("@/lib/work/store");
    const parallel = num(fd, "parallel");
    if (parallel === undefined || parallel < 1 || parallel > 8) return { ok: false, error: t("1 to 8 workers at once.") };
    const permissionMode = str(fd, "permissionMode") ?? "auto";
    if (!(PERMISSION_MODES as readonly string[]).includes(permissionMode)) return { ok: false, error: t("Unknown permission mode.") };
    const isolation = str(fd, "isolation") === "checkout" ? "checkout" : "worktree";
    const { COPILOT_MODES } = await import("@/lib/work/shared");
    const copilotMode = (COPILOT_MODES as readonly string[]).includes(str(fd, "copilotMode") ?? "") ? (str(fd, "copilotMode") as (typeof COPILOT_MODES)[number]) : undefined;
    const model = (str(fd, "model") ?? "").trim();
    if (model && !/^[\w.:\[\]-]{2,60}$/.test(model)) return { ok: false, error: t("A model name like sonnet, opus or claude-sonnet-5-5.") };
    updateWorkSettings({
      parallel,
      permissionMode: permissionMode as (typeof PERMISSION_MODES)[number],
      isolation,
      ...(copilotMode ? { copilotMode } : {}),
      model,
      instructions: str(fd, "instructions") ?? "",
      agentInstructions: { code: str(fd, "agentInstructionCode") ?? "", other: str(fd, "agentInstructionOther") ?? "" },
    });
    const { pump } = await import("@/lib/work/runner");
    pump(); // more workers: the queue goes on at once
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A repo for workers (Repos page): new, or the one with `id` changed. */
export async function saveRepoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { saveRepo } = await import("@/lib/repos");
    const id = num(fd, "id");
    const r = saveRepo(
      {
        name: str(fd, "name") ?? "",
        path: str(fd, "path") ?? "",
        gitlabProject: str(fd, "gitlabProject") ?? null,
        boards: fd.getAll("boards").map((b) => Number(b)),
        tickets: (str(fd, "tickets") ?? "").split(/[\s,;]+/),
        instructions: str(fd, "instructions") ?? "",
        delivery: str(fd, "delivery") === "direct" ? "direct" : "mr",
      },
      id || undefined,
    );
    revalidateAll();
    return { ok: true, message: id ? t("Saved {name}.", { name: r.name }) : t("Added {name}.", { name: r.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteRepoAction(id: number): Promise<ActionState> {
  try {
    const { deleteRepo } = await import("@/lib/repos");
    deleteRepo(Number(id));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Switch a repo's checkout to another local branch (Work tab). */
export async function switchRepoBranchAction(repoId: number, branch: string): Promise<ActionState> {
  try {
    const { switchBranch } = await import("@/lib/repos");
    const now = switchBranch(Number(repoId), String(branch));
    (await import("@/lib/branches")).forgetBranchWork();
    revalidateAll();
    return { ok: true, message: t("Now on {branch}.", { branch: now }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** What a local branch needs, done on your click (push, open or merge its MR, delete) — or (not) listing it any more. */
export async function branchOpAction(repoId: number, branch: string, op: string): Promise<ActionState> {
  try {
    const ops = ["push", "open-mr", "merge", "delete", "ignore", "unignore", "ignore-stale"] as const;
    if (!(ops as readonly string[]).includes(op)) return { ok: false, error: t("Unknown operation.") };
    const { branchOp } = await import("@/lib/branches");
    const message = await branchOp(Number(repoId), String(branch), op as (typeof ops)[number]);
    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Live Claude sessions' settings (Work → Settings → Claude sessions). */
export async function saveClaudeSessionSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { EFFORTS, isClaudeMode } = await import("@/lib/work/shared");
    const { updateClaudeSessionSettings } = await import("@/lib/work/store");
    const mode = str(fd, "mode") ?? "default";
    const autoMode = str(fd, "autoMode") ?? "auto";
    if (!isClaudeMode(mode) || !isClaudeMode(autoMode)) return { ok: false, error: t("Unknown permission mode.") };
    const allowBypass = fd.get("allowBypass") === "on";
    if (!allowBypass && (mode === "bypassPermissions" || autoMode === "bypassPermissions")) return { ok: false, error: t("Bypass isn't allowed — tick “Bypass may be picked” first.") };
    const effort = str(fd, "effort") ?? "";
    if (!(EFFORTS as readonly string[]).includes(effort)) return { ok: false, error: t("Unknown effort.") };
    const askTimeoutMin = num(fd, "askTimeoutMin") ?? 0;
    updateClaudeSessionSettings({ live: fd.get("live") === "on", mode, autoMode, effort: effort as (typeof EFFORTS)[number], allowBypass, askTimeoutMin });
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Admin sessions: started without asking (the scheduled task — Windows asks once, now) or with UAC each time. */
export async function setAdminSessionsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("work-elevated")) return { ok: false, error: t("The Admin sessions plugin isn't installed.") };
    const { installTask, removeTask, setElevationMode } = await import("@/plugins/work-elevated/elevate");
    const what = str(fd, "do");
    if (what === "install") await installTask();
    else if (what === "remove") await removeTask();
    else if (what === "uac") setElevationMode("uac");
    else return { ok: false, error: t("Unknown action.") };
    revalidatePath("/work/admin");
    return { ok: true, message: what === "install" ? t("Set up — admin sessions start without asking.") : what === "remove" ? t("Removed — Windows asks each time again.") : t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
