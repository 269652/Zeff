import { aiChoice, runAi } from "@/lib/ai";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";
import type { LlmTaskId } from "@/plugins/llm/tasks";

/**
 * What the AI jobs that go through many things in batches share: one run at a time (per account),
 * the things cut into prompts of a size, and — for the relate jobs (mails, notes, documents to the
 * open todos) — the whole round of asking and taking what was picked.
 */

/** One run at a time: while `flag`'s run is going, the same promise; the flag is cleared when it ends. */
export function singleFlight<T>(flag: string, job: () => Promise<T>): Promise<T> {
  const running = accountFlag<Promise<T>>(flag);
  if (running) return running;
  const run = job().finally(() => {
    setAccountFlag(flag, null);
  });
  setAccountFlag(flag, run);
  return run;
}

/** A prompt's room: `chars` for Copilot (it takes the prompt on the command line), three times that for the others. */
export const promptRoom = (chars: number): number => (aiChoice().provider === "copilot" ? chars : 3 * chars);

/** The items in batches in their order: a new one when the next item would make it longer than `limit` (or it has `max` items). */
export function batchByChars<T>(items: T[], sizeOf: (item: T) => number, limit: number, max = Infinity): T[][] {
  const batches: T[][] = [];
  let size = 0;
  for (const item of items) {
    const n = sizeOf(item);
    if (!batches.length || size + n > limit || batches[batches.length - 1].length >= max) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1].push(item);
    size += n;
  }
  return batches;
}

/** "2 of 5 parts failed" — when some did. */
export const partsFailed = (failed: number, n: number): { error?: string } => (failed ? { error: t("{failed} of {n} parts failed", { failed, n }) } : {});

/** What a relate job answers. */
export type RelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

/**
 * A relate job's round: the groups (a todo or a ticket's todos, with their candidates) in batches of
 * `room` characters, each batch one prompt; the AI answers per todo the refs it picked (`field`),
 * `take` keeps what it may of them. A batch that fails: its todos keep what they have.
 */
export async function relateInBatches<G>(o: {
  task: LlmTaskId;
  groups: G[];
  block: (g: G) => string;
  room: number;
  prompt: (blocks: string) => string;
  schema: object;
  field: string;
  take: (g: G, said: Map<number, string[]>) => void;
  beforeBatch?: () => void;
}): Promise<{ batches: number; failed: number }> {
  const batches = batchByChars(o.groups, (g) => o.block(g).length, o.room);
  let failed = 0;
  for (const batch of batches) {
    o.beforeBatch?.();
    const prompt = o.prompt(batch.map(o.block).join("\n\n"));
    const answer = await runAi<{ todos?: ({ id?: number } & Record<string, unknown>)[] }>(prompt, o.schema, { task: o.task, timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
      console.error(`[${o.task}]`, errorMessage(e));
      failed++;
      return null;
    });
    if (!answer) continue;
    const said = new Map((answer.output?.todos ?? []).filter((x) => Number.isInteger(x?.id)).map((x) => [x.id!, (x[o.field] as string[] | undefined) ?? []]));
    for (const g of batch) o.take(g, said);
  }
  return { batches: batches.length, failed };
}

/** A relate job, whole: one at a time, its round's outcome as a RelationResult, an error in it logged and answered. */
export function relateJob(flag: string, task: string, job: () => Promise<{ todos: number; changed: number; batches: number; failed: number }>): Promise<RelationResult> {
  return singleFlight(flag, () =>
    job()
      .then(({ todos, changed, batches, failed }): RelationResult => ({ ok: failed < batches || !batches, todos, changed, batches, ...partsFailed(failed, batches) }))
      .catch((e): RelationResult => {
        console.error(`[${task}]`, errorMessage(e));
        return { ok: false, todos: 0, changed: 0, batches: 0, error: errorMessage(e) };
      }),
  );
}
