import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// Live Claude sessions end to end: the real host (scripts/work-host.mjs) and driver, a fake CLI
// that speaks the stream-json control protocol (tests/fake-claude-live.mjs) — no Claude, no cost.
setupTempData();
const FAKE = path.join(ROOT, "tests", "fake-claude-live.mjs");

const until = async (what: string, ok: () => boolean, ms = 20000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** A running run on a fresh todo, and its live session started (as the runner would). */
async function session(prompt: string, conversation: boolean) {
  const { addSessionTodo } = await import("@/lib/boards/store");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const { startClaudeSession } = await import("@/plugins/claude-cli/live");
  const todo = addSessionTodo({ ticket: "", text: "Live session test" });
  const run = createRun({ ticket: "", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: "default", repo: null, prompt });
  updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
  await startClaudeSession(
    {
      runId: run.id,
      conversation,
      elevated: false,
      effort: "",
      model: null,
      mode: "default",
      allowBypass: false,
      askTimeoutMin: 0,
      command: process.execPath,
      args: [FAKE, "--replay-user-messages"],
      cwd: ROOT,
      newSessionId: `s-${run.id}`,
    },
    prompt,
  );
  return run.id;
}

const view = async (id: number) => (await import("@/plugins/claude-cli/live")).claudeLiveView(id);
const status = async (id: number) => (await import("@/lib/work/store")).getRun(id)?.status;

test("a conversation: it asks, you allow, it waits for you; finishing ends it with its result", async () => {
  const live = await import("@/plugins/claude-cli/live");
  const id = await session("ASK to run something", true);
  await until("its question", () => (live.claudeLiveView(id)?.session.asks.length ?? 0) > 0);
  const ask = (await view(id))!.session.asks[0];
  assert.equal(ask.tool, "Bash");
  assert.equal(ask.input.command, "echo hi");
  await live.answer(id, ask.requestId, { behavior: "allow" });
  await until("its turn over", () => live.claudeLiveView(id)?.live.waiting != null);
  assert.match(live.claudeLiveView(id)!.live.waiting!, /Echo: ASK/);
  assert.equal(await status(id), "running", "a conversation waits for you");
  // The commands and models from initialize.
  assert.ok(live.claudeLiveView(id)!.session.commands.some((c) => c.name === "review"));
  assert.equal(live.claudeLiveView(id)!.session.models[0]?.value, "fake-model");

  await live.finishClaude(id);
  let st: string | undefined;
  await until("the run done", () => {
    void status(id).then((s) => (st = s));
    return st === "done";
  });
  const { getRun } = await import("@/lib/work/store");
  const run = getRun(id)!;
  assert.equal(run.summary, "Fake work done.");
  assert.ok((run.costUsd ?? 0) > 0);
  assert.equal(run.turns, 2);

  // The log, as the page shows it: its question with your answer, its words (the first message is the turn's own, shown above it).
  const { readLog } = await import("@/lib/work/log");
  const lines = readLog(id).lines;
  assert.ok(!lines.some((l) => l.k === "you" && /ASK to run/.test(l.text)));
  const asked = lines.find((l) => l.k === "ask");
  assert.ok(asked && asked.k === "ask" && asked.answer === "allowed", JSON.stringify(asked));
  assert.ok(lines.some((l) => l.k === "say" && /Echo: ASK/.test(l.text)));
});

test("a task ends on its own when its result comes", async () => {
  const id = await session("RESULT please", false);
  let st: string | undefined;
  await until("the run done", () => {
    void status(id).then((s) => (st = s));
    return st === "done";
  });
});

test("questions get your answers; Zeff restarting doesn't end the session", async () => {
  const live = await import("@/plugins/claude-cli/live");
  const id = await session("QUESTION for you", true);
  await until("its question", () => (live.claudeLiveView(id)?.session.asks.length ?? 0) > 0);
  const ask = live.claudeLiveView(id)!.session.asks[0];
  assert.equal(ask.tool, "AskUserQuestion");
  await live.answer(id, ask.requestId, { behavior: "allow", answers: { "Which one?": "B" } });
  await until("its answer", () => /You chose B/.test(live.claudeLiveView(id)?.live.waiting ?? ""));

  // A restart: the server forgets the session (its host goes on) and finds it again.
  live.claudeLives.get(id)?.sock?.destroy();
  live.claudeLives.delete(id);
  live.reattachClaudeSessions([id]);
  await until("found again", () => live.claudeLiveView(id)?.live.waiting != null);
  assert.match(live.claudeLiveView(id)!.live.waiting!, /You chose B/, "where it stood, from its log");
  await live.sendToClaude(id, "hello again");
  await until("the next turn", () => /Echo: hello again/.test(live.claudeLiveView(id)?.live.waiting ?? ""));
  const { readLog } = await import("@/lib/work/log");
  assert.ok(readLog(id).lines.some((l) => l.k === "you" && l.text === "hello again"), "your later message, as the CLI took it in");

  // Its mode switched; then closed without a result.
  await live.setClaudeMode(id, "acceptEdits");
  await until("mode", () => live.claudeLiveView(id)?.live.mode === "acceptEdits");
  await assert.rejects(live.setClaudeMode(id, "bypassPermissions"), /Bypass isn't allowed/);
  await live.closeClaude(id);
  let st: string | undefined;
  await until("closed", () => {
    void status(id).then((s) => (st = s));
    return st === "done";
  });
  const { getRun } = await import("@/lib/work/store");
  assert.match(getRun(id)!.summary ?? "", /Echo: hello again/);
  assert.equal(getRun(id)!.result, null, "closed: no result taken in");
});

test("a turn can be stopped", async () => {
  const live = await import("@/plugins/claude-cli/live");
  const id = await session("SLOW work", true);
  const { readLog } = await import("@/lib/work/log");
  // Its slow turn under way (it says so), then stopped.
  await until("working", () => readLog(id).lines.some((l) => l.k === "say" && /Working slowly/.test(l.text)));
  await live.interruptClaude(id);
  await until("stopped", () => live.claudeLiveView(id)?.live.waiting !== null && live.claudeLiveView(id)?.live.busy === false);
  assert.ok(readLog(id).lines.some((l) => l.k === "note" && /Turn stopped/.test(l.text)));
  const { cancelRun } = await import("@/lib/work/runner");
  cancelRun(id);
  assert.equal(await status(id), "cancelled");
});
