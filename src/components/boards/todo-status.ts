"use client";

import { confirmAction } from "@/components/confirm";
import { setTodoStatusAction } from "@/plugins/todos/server-actions";

/**
 * A todo's status set from a click — and when it is a repeat ticked off before its time (the next rate, due in three weeks), asked
 * first: yes sends it again as meant, no leaves it open (`cancelled`, no error to show). Every checkbox of a todo goes through here.
 */
export async function setTodoStatusConfirmed(id: number, status: "open" | "done" | "dismissed"): Promise<{ ok: boolean; error?: string; message?: string; cancelled?: boolean } | null> {
  const r = await setTodoStatusAction(id, status);
  if (!r || r.ok || !r.confirm) return r;
  if (!confirmAction(r.confirm)) return { ok: false, cancelled: true };
  return setTodoStatusAction(id, status, { early: true });
}
