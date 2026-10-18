import { runAutomation } from "./automation";
import { startAgent, type AgentDeps } from "./routine-agent";
import { getRoutine, listRoutines, type RunStatus, type Trigger } from "./routines";

/**
 * Run a routine, whatever it is: an automation runs through its steps (and its result is the run's); an agent starts a worker and
 * goes on in the background ("started"). Triggers, the scheduler, the API and `run` steps all come here.
 */
/** A routine run - and what it changed in the Workspace, as one entry of the history (Undo). */
export async function runRoutine(
  pageId: number,
  trigger: Trigger,
  ctx: { row?: number; payload?: Record<string, string>; depth?: number } = {},
  agentDeps?: Partial<AgentDeps>,
): Promise<{ status: RunStatus | "started"; runId?: number; error?: string }> {
  const { undoable } = await import("./undo");
  return (await undoable(listRoutines().find((r) => r.pageId === pageId)?.title || "Automation", () => runRoutineSteps(pageId, trigger, ctx, agentDeps), "source")).value;
}

async function runRoutineSteps(
  pageId: number,
  trigger: Trigger,
  ctx: { row?: number; payload?: Record<string, string>; depth?: number } = {},
  agentDeps?: Partial<AgentDeps>,
): Promise<{ status: RunStatus | "started"; runId?: number; error?: string }> {
  const routine = getRoutine(pageId);
  if (!routine) throw new Error("This page is no routine.");
  if (routine.kind === "automation") {
    const r = await runAutomation(pageId, trigger, { row: ctx.row, payload: ctx.payload, depth: ctx.depth });
    return { status: r.status, runId: r.runId, error: r.error };
  }
  const r = await startAgent(pageId, trigger, { row: ctx.row, payload: ctx.payload }, agentDeps);
  return { status: r.status, runId: r.runId, error: r.error };
}
