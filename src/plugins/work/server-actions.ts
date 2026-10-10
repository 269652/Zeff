"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { num, revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Work: todos handed to workers — its server actions (each answers an ActionState unless it says otherwise). */

/** Hand a todo to a worker (provider: the AI settings' unless given) — queued, started when one is free. */
/**
 * A work session (Work, like Claude Code): your instruction to a worker — on a todo (it goes on
 * where that one is), or as a new todo on a ticket (or none) — in a repo you pick, else the
 * ticket's. Interactive with the Copilot CLI (the Work settings): you talk to it on its page.
 */
export async function startSessionAction(v: { instruction: string; ticket?: string; todoId?: number; repoId?: number; provider?: string }): Promise<{ ok: true; runId: number } | { ok: false; error: string }> {
  try {
    const instruction = String(v.instruction ?? "").trim();
    // A todo without words: it's worked on as it is (its brief).
    if (!instruction && v.todoId) {
      const { dispatchTodo } = await import("@/lib/work/runner");
      const run = dispatchTodo(Number(v.todoId));
      revalidatePath("/work");
      return { ok: true, runId: run.id };
    }
    if (!instruction) return { ok: false, error: "Was soll der Worker tun?" };
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const { addSessionTodo, getTodo } = await import("@/lib/boards/store");
    // On its todo, while it's open; else a new todo (on the ticket, or none).
    const existing = v.todoId ? getTodo(Number(v.todoId)) : undefined;
    const ticket = String(v.ticket ?? existing?.ticket ?? "").trim();
    if (ticket && !/^[A-Z][A-Z0-9]+-\d+$/i.test(ticket)) return { ok: false, error: `„${ticket}“ ist kein Ticket.` };
    const todo = existing?.status === "open" ? existing : addSessionTodo({ ticket, text: instruction.split("\n")[0].slice(0, 200) });
    const run = dispatchTodo(todo.id, { instruction, provider: isAiProvider(v.provider) ? v.provider : undefined, repoId: v.repoId ? Number(v.repoId) : undefined });
    revalidatePath("/work");
    return { ok: true, runId: run.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function dispatchWorkAction(todoId: number, provider?: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: provider && isAiProvider(provider) ? provider : undefined });
    revalidateAll();
    return { ok: true, message: `${run.ref} ${run.status === "running" ? "is running" : "waits for a free worker"}.` };
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
    if (!r) return { ok: false, error: "Den Lauf gibt es nicht mehr." };
    const instruction = r.mode === "instruct" ? /## Deine Anweisung \(vom Nutzer — sie geht vor\)\n([\s\S]*?)(?:\n\n## Dein Auftrag|$)/.exec(r.prompt ?? "")?.[1]?.trim() : undefined;
    if (r.mode === "instruct" && !instruction) return { ok: false, error: "Die Anweisung ist nicht mehr zu finden — gib sie über ✨ neu ein." };
    const run = dispatchTodo(r.todoId, { provider: isAiProvider(r.provider) ? r.provider : undefined, instruction });
    const { markRunErrorSeen } = await import("@/lib/work/store");
    markRunErrorSeen(r.id);
    revalidateAll();
    return { ok: true, message: `${run.ref} ${run.status === "running" ? "läuft" : "wartet auf einen freien Worker"}.` };
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
    if (parallel === undefined || parallel < 1 || parallel > 8) return { ok: false, error: "1 to 8 workers at once." };
    const permissionMode = str(fd, "permissionMode") ?? "auto";
    if (!(PERMISSION_MODES as readonly string[]).includes(permissionMode)) return { ok: false, error: "Unknown permission mode." };
    const isolation = str(fd, "isolation") === "checkout" ? "checkout" : "worktree";
    const { COPILOT_MODES } = await import("@/lib/work/shared");
    const copilotMode = (COPILOT_MODES as readonly string[]).includes(str(fd, "copilotMode") ?? "") ? (str(fd, "copilotMode") as (typeof COPILOT_MODES)[number]) : undefined;
    const model = (str(fd, "model") ?? "").trim();
    if (model && !/^[\w.:\[\]-]{2,60}$/.test(model)) return { ok: false, error: "A model name like sonnet, opus or claude-sonnet-5-5." };
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
    return { ok: true, message: "Saved." };
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
    return { ok: true, message: `${id ? "Saved" : "Added"} ${r.name}.` };
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
    return { ok: true, message: `Now on ${now}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** What a local branch needs, done on your click (push, open or merge its MR, delete) — or (not) listing it any more. */
export async function branchOpAction(repoId: number, branch: string, op: string): Promise<ActionState> {
  try {
    const ops = ["push", "open-mr", "merge", "delete", "ignore", "unignore", "ignore-stale"] as const;
    if (!(ops as readonly string[]).includes(op)) return { ok: false, error: "Unknown operation." };
    const { branchOp } = await import("@/lib/branches");
    const message = await branchOp(Number(repoId), String(branch), op as (typeof ops)[number]);
    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
