import assert from "node:assert/strict";
import test from "node:test";
import { answerKey, createAnswerCache, createGate, retryable, withNoJsonRetry } from "../src/lib/ai/guard";
import { NoJsonError } from "../src/lib/ai/json";
import { ABORTED } from "../src/lib/abort";
import { IDEMPOTENT_TASKS } from "../src/plugins/llm/tasks";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("the cache gives an answer back until its time is up", () => {
  let now = 1000;
  const c = createAnswerCache<string>({ ttlMs: 100, max: 5, now: () => now });
  c.set("a", "A");
  assert.equal(c.get("a"), "A");
  now += 99;
  assert.equal(c.get("a"), "A");
  now += 1;
  assert.equal(c.get("a"), undefined);
  assert.equal(c.size, 0);
});

test("the cache holds at most max entries, the oldest goes first", () => {
  const c = createAnswerCache<number>({ ttlMs: 1e9, max: 3 });
  for (let i = 0; i < 5; i++) c.set(`k${i}`, i);
  assert.equal(c.size, 3);
  assert.equal(c.get("k0"), undefined);
  assert.equal(c.get("k1"), undefined);
  assert.equal(c.get("k4"), 4);
  c.set("k2", 22); // set again: now the newest
  c.set("k5", 5);
  assert.equal(c.get("k2"), 22);
  assert.equal(c.get("k3"), undefined);
});

test("answerKey tells every part of a call apart", () => {
  const base = answerKey(["news-digest", "claude", "sonnet", { a: 1 }, "prompt"]);
  assert.equal(base, answerKey(["news-digest", "claude", "sonnet", { a: 1 }, "prompt"]));
  const others = [
    ["x", "claude", "sonnet", { a: 1 }, "prompt"],
    ["news-digest", "codex", "sonnet", { a: 1 }, "prompt"],
    ["news-digest", "claude", "opus", { a: 1 }, "prompt"],
    ["news-digest", "claude", "sonnet", { a: 2 }, "prompt"],
    ["news-digest", "claude", "sonnet", { a: 1 }, "prompt "],
  ];
  for (const other of others) assert.notEqual(base, answerKey(other));
});

test("only the explicitly idempotent tasks are cached, never a review", () => {
  assert.deepEqual([...IDEMPOTENT_TASKS].sort(), ["ai-filter", "knowledge-relations", "news-digest", "news-retag", "people-classify", "people-normalize", "repeat-text"]);
  for (const t of ["mail-todos", "note-todos", "doc-todos", "mail-relations", "ticket-lage", "worker", "general"] as const) assert.equal(IDEMPOTENT_TASKS.has(t), false);
});

test("the gate lets only max run at once and keeps the order", async () => {
  const gate = createGate(2);
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const release: (() => void)[] = [];
  const job = (i: number) =>
    gate.run(async () => {
      started.push(i);
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((r) => release.push(r));
      running--;
      return i;
    });
  const all = [0, 1, 2, 3].map(job);
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(gate.waiting, 2);
  release.shift()!();
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  while (release.length || gate.active) {
    release.shift()?.();
    await tick();
  }
  assert.deepEqual(await Promise.all(all), [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.equal(gate.active, 0);
});

test("the gate gives the slot back when a job fails", async () => {
  const gate = createGate(1);
  await assert.rejects(
    gate.run(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(gate.active, 0);
  assert.equal(await gate.run(async () => "next"), "next");
});

test("a waiter that is stopped leaves the line and the slot still passes on", async () => {
  const gate = createGate(1);
  let free!: () => void;
  const first = gate.run(() => new Promise<void>((r) => (free = r)));
  const stop = new AbortController();
  const waiting = gate.run(async () => "never", stop.signal);
  const third = gate.run(async () => "third");
  await tick();
  assert.equal(gate.waiting, 2);
  stop.abort();
  await assert.rejects(waiting, new RegExp(ABORTED));
  assert.equal(gate.waiting, 1);
  free();
  await first;
  assert.equal(await third, "third");
  assert.equal(gate.active, 0);
  await assert.rejects(gate.run(async () => 1, stop.signal), new RegExp(ABORTED)); // stopped already
});

test("retry: only Copilot and Codex, only an answer without JSON", () => {
  const noJson = new NoJsonError("no JSON");
  assert.equal(retryable("copilot", noJson), true);
  assert.equal(retryable("codex", noJson), true);
  assert.equal(retryable("claude", noJson), false);
  assert.equal(retryable("copilot", new Error("The Copilot CLI took longer than 10 minutes — stopped.")), false);
  assert.equal(retryable("codex", new Error(ABORTED)), false);
  assert.equal(retryable("copilot", new Error("The Copilot CLI failed (exit 1): x")), false);
});

test("withNoJsonRetry asks twice at most, and not for other failures", async () => {
  let calls = 0;
  const flaky = async () => {
    if (++calls === 1) throw new NoJsonError("no JSON");
    return "ok";
  };
  assert.equal(await withNoJsonRetry("copilot", flaky), "ok");
  assert.equal(calls, 2);

  const failing = (provider: "copilot" | "codex" | "claude", error: Error) => {
    calls = 0;
    return withNoJsonRetry(provider, async () => {
      calls++;
      throw error;
    });
  };
  await assert.rejects(failing("codex", new NoJsonError("still none")), /still none/);
  assert.equal(calls, 2);
  await assert.rejects(failing("copilot", new Error("exit 1")), /exit 1/);
  assert.equal(calls, 1);
  await assert.rejects(failing("claude", new NoJsonError("claude")), /claude/);
  assert.equal(calls, 1);
});

test("withNoJsonRetry stops before the second try when told to", async () => {
  let calls = 0;
  await assert.rejects(
    withNoJsonRetry(
      "copilot",
      async () => {
        calls++;
        throw new NoJsonError("none");
      },
      () => {
        throw new Error(ABORTED);
      },
    ),
    new RegExp(ABORTED),
  );
  assert.equal(calls, 1);
});
