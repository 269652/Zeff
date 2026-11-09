"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * A message in the chat: a new chat (its own todo, then a live Claude session on it), or the next message in one
 * (`runId`: the chat's newest run — it goes into the running session, or resumes it). Always Claude, as a live
 * session: the agent works in Zeff through Zeff's tools (src/lib/chat.ts) and asks here before acting outside it.
 */
export async function chatSendAction(v: { text: string; runId?: number }): Promise<{ ok: true; runId: number } | { ok: false; error: string }> {
  try {
    const text = String(v.text ?? "").trim();
    if (!text) return { ok: false, error: t("What should Zeff do?") };
    const { startSessionAction } = await import("@/plugins/work/server-actions");
    const session = { permissionMode: "default" };
    let r;
    // (No provider when going on: naming one makes a new run queued behind a running session instead of a message into it.)
    if (v.runId) {
      // Its session still running (waiting for you): the message goes into it — never a run queued behind it, which
      // would wait for that session to end (and it doesn't: it waits for you).
      const into = await (await import("@/lib/work/live-state")).sendToSession(Number(v.runId), text);
      if (into) {
        revalidatePath("/chat");
        return { ok: true, runId: into };
      }
      r = await startSessionAction({ instruction: text, continueRunId: Number(v.runId), session });
    }
    else {
      const { addChatTodo } = await import("@/lib/chat");
      r = await startSessionAction({ instruction: text, todoId: addChatTodo(text), provider: "claude", session });
    }
    revalidatePath("/chat");
    return r;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
