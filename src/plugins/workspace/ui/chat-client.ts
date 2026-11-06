"use client";

import { startWorkspaceChatAction, workspaceChatJobAction } from "../actions";
import type { ChatStep } from "../agent";
import type { ChatOutcome } from "../chat-jobs";

type Talk = { role: "user" | "assistant"; text: string }[];
export type ChatAnswer = ({ ok: true } & ChatOutcome) | { ok: false; error: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A talk with the assistant: started on the server, followed from here. A failed look (a busy server) isn't the end of it: only many in a row are. */
export async function askWorkspace(talk: Talk, pageId: number | undefined, onSteps?: (steps: ChatStep[]) => void): Promise<ChatAnswer> {
  const started = await startWorkspaceChatAction(talk, pageId);
  if (!started.ok) return { ok: false, error: started.error };
  for (let missed = 0; missed < 60; ) {
    await wait(1500);
    const r = await workspaceChatJobAction(started.id).catch(() => null);
    if (!r?.ok) {
      missed++;
      continue;
    }
    missed = 0;
    onSteps?.(r.steps);
    if (r.done) return r.result ? { ok: true, ...r.result } : { ok: false, error: r.error ?? "" };
  }
  throw new Error("The server doesn't answer.");
}
