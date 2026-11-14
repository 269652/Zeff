"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// The chats external plugins bring (lib/work/ext-chat.ts): what the view tag <chat> shows and starts
// ---------------------------------------------------------------------------

/**
 * Where a chat of that key stands: its todo and runs, the live session if one is running (it takes the next message), a failed or lost
 * run, one waiting for a worker. Looking at it also brings the conversation database up to date, and when someone changed the stored
 * conversation since the session last spoke, that session is closed — the next message starts afresh with the stored conversation.
 */
export async function chatStateAction(chat: string, key: string) {
  return run(async () => {
    const { extChat, todoOfKey } = await import("@/lib/work/ext-chat");
    const c = extChat(String(chat));
    if (!c) throw new Error(`There is no chat “${String(chat).slice(0, 60)}” (the plugin must be on and bring it).`);
    const todoId = todoOfKey(`${c.plugin}.${c.id}`, String(key));
    if (!todoId) return { todoId: null, version: 0, live: null, last: null, stuck: null, queued: false, active: false };
    const { runsForTodos } = await import("@/lib/work/store");
    const { isActive } = await import("@/lib/work/shared");
    const conv = await import("../chat-conversation");
    conv.syncChat(todoId);
    const runs = [...(runsForTodos([todoId]).get(todoId) ?? [])].reverse();
    const last = runs[runs.length - 1];
    let live = [...runs].reverse().find((r) => !!r.session && r.status === "running");
    if (live && c.conversation && conv.chatChanged(todoId)) {
      const { liveState } = await import("@/lib/work/live-state");
      if (!(await liveState(live.id)).busy) {
        const runId = live.id;
        const { delegates } = await import("@/lib/host/role");
        await (delegates() ? (await import("@/lib/host/client")).callHost("work.liveDo", { runId, body: { do: "close" } }, 15000) : (await import("@/lib/work/live-actions")).liveDo(runId, { do: "close" }));
        live = undefined;
      }
    }
    const lost = live ? undefined : runs.find((r) => r.status === "running" && !r.session && !r.live);
    const stuck = lost && !(await (await import("@/lib/work/live-state")).liveState(lost.id)).followed ? lost : undefined;
    const version = conv.messagesOf(todoId).length;
    return {
      todoId,
      version,
      live: live ?? null,
      last: last ? { id: last.id, status: last.status, error: last.error ?? null } : null,
      stuck: stuck ? stuck.id : null,
      queued: !live && last?.status === "queued",
      active: !!last && isActive(last.status),
    };
  });
}

/**
 * A message into a chat of that key — what a widget reports, a button says: into its running session, or resuming it. A chat that has not
 * begun hears nothing ({ runId: null }) — an exercise done before its lesson's chat was opened still counts, it just has no one to tell.
 */
export async function chatTellAction(chat: string, key: string, text: string) {
  return run(async () => {
    const { extChat, todoOfKey } = await import("@/lib/work/ext-chat");
    const c = extChat(String(chat));
    if (!c) throw new Error(`There is no chat "${chat}".`);
    const todoId = todoOfKey(`${c.plugin}.${c.id}`, String(key));
    const { runsForTodos } = await import("@/lib/work/store");
    const newest = todoId ? runsForTodos([todoId]).get(todoId)?.[0] : undefined;
    if (!newest) return { runId: null };
    const { chatSendAction } = await import("@/app/chat/actions");
    const r = await chatSendAction({ text: String(text).slice(0, 4000), runId: newest.id });
    if (!r.ok) throw new Error(r.error);
    return { runId: r.runId };
  });
}

/** The first message of a chat of that key: its todo is made (once), a live session starts on it with `first` as the opening. */
export async function chatStartAction(chat: string, key: string, title: string, first: string) {
  return run(async () => {
    const { extChat, ensureChatTodo } = await import("@/lib/work/ext-chat");
    const c = extChat(String(chat));
    if (!c) throw new Error(`There is no chat “${String(chat).slice(0, 60)}” (the plugin must be on and bring it).`);
    const todoId = ensureChatTodo(c, String(key).slice(0, 200), String(title || key).slice(0, 200));
    const { runsForTodos } = await import("@/lib/work/store");
    const newest = runsForTodos([todoId]).get(todoId)?.[0];
    if (newest) return { todoId, runId: newest.id };
    const { startSessionAction } = await import("@/plugins/work/server-actions");
    const r = await startSessionAction({ instruction: String(first || "Let's begin.").slice(0, 2000), todoId, provider: "claude", session: { permissionMode: "default" } });
    if (!r.ok) throw new Error(r.error);
    return { todoId, runId: r.runId };
  });
}
