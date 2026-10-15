import { getTodo } from "@/lib/boards/store";
import { emitChange } from "@/lib/events";

/**
 * Every todo that comes into being gets its actions looked at - not only those the Ticket-Lage made: the todos a worker's
 * result created (follow-ups) go through the same review as soon as they exist, in the background. A todo that already has
 * actions (the worker brought them) is left alone. Server only.
 */
export function ensureActions(ids: number[]): void {
  const need = ids.filter((id) => getTodo(id)?.ops.length === 0);
  if (!need.length || process.env.ZEFF_NO_AI) return;
  void import("@/plugins/auto-actions/review")
    .then((m) => m.reviewTodosForActions({ ids: need }))
    .catch(() => {})
    .finally(() => emitChange("todos"));
}
