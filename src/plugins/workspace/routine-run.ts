import { runAutomation } from "./automation";
import { getRoutine, type RunStatus, type Trigger } from "./routines";

/**
 * Run a routine, whatever it is: an automation runs through its steps (and its result is the run's); an agent starts a worker and
 * goes on in the background ("started"). Triggers, the scheduler, the API and `run` steps all come here.
 */
export async function runRoutine(
  pageId: number,
  trigger: Trigger,
  ctx: { row?: number; payload?: Record<string, string>; depth?: number } = {},
): Promise<{ status: RunStatus | "started"; runId?: number; error?: string }> {
  const routine = getRoutine(pageId);
  if (!routine) throw new Error("This page is no routine.");
  if (routine.kind === "automation") {
    const r = await runAutomation(pageId, trigger, { row: ctx.row, payload: ctx.payload, depth: ctx.depth });
    return { status: r.status, runId: r.runId, error: r.error };
  }
  throw new Error("Agents are started in routine-agent.");
}
