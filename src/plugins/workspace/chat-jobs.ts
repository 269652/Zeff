import { randomUUID } from "node:crypto";
import type { ChatResult, ChatStep } from "./agent";

/**
 * A talk with the Workspace assistant in the background: it takes minutes, and a request held open that long can break off while the
 * AI goes on changing things — the page then says it failed, though it is done. The page starts it and asks how far it is. In this
 * server's memory; finished ones are dropped after an hour. Server only.
 */
export type ChatOutcome = ChatResult & { undoId?: number | null };
export type ChatJob = { done: boolean; steps: ChatStep[]; result?: ChatOutcome; error?: string; at: number };

const g = globalThis as { __zeffChatJobs?: Map<string, ChatJob> };
const jobs = () => (g.__zeffChatJobs ??= new Map());
const HOUR = 3600e3;

export function startChatJob(work: (onStep: (steps: ChatStep[]) => void) => Promise<ChatOutcome>): string {
  for (const [k, j] of jobs()) if (j.done && Date.now() - j.at > HOUR) jobs().delete(k);
  const id = randomUUID();
  const job: ChatJob = { done: false, steps: [], at: Date.now() };
  jobs().set(id, job);
  const end = (patch: Partial<ChatJob>) => Object.assign(job, patch, { done: true, at: Date.now() });
  void work((steps) => (job.steps = [...steps])).then(
    (result) => end({ result }),
    (e: unknown) => end({ error: e instanceof Error ? e.message : String(e) }),
  );
  return id;
}

export const chatJob = (id: string): ChatJob | null => jobs().get(id) ?? null;
