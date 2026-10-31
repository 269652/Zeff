import type { TodoOp } from "@/lib/todos/shared";
import { ApiError } from "@/lib/plugins/api-kit";
import type { ActionContext, ActionResult } from "./run-types";

/**
 * Runs "Do in Zeff": the method the op names, offered by an installed plugin, with the fields the AI wrote checked again
 * (the offer may have changed since the op was proposed). Called as Zeff itself — the click is the permission. Server only.
 */
export async function runZeffDo(op: Extract<TodoOp, { type: "zeff-do" }>, ctx: ActionContext): Promise<ActionResult> {
  const { offeredMethods } = await import("./server");
  const { callBuiltin } = await import("@/lib/plugins/api");
  const m = offeredMethods()[op.method];
  if (!m) throw new ApiError("not_found", `${op.method}: not offered (its plugin isn't installed any more).`);
  const params = m.offer.check(op.args);
  if (!params) throw new ApiError("bad_request", `${op.method}: the fields aren't complete any more.`);
  ctx.note(op.title);
  const result = await callBuiltin("auto-actions", op.method, params);
  const d = m.offer.describe(params);
  return { what: d.title, todoNote: typeof result === "string" ? result : undefined };
}
