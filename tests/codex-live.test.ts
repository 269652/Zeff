import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// Live Codex sessions end to end: the real session host (scripts/work-session-host.mjs) and the
// Codex driver (plugins/codex-cli/live.ts), a stand-in for `codex app-server` that speaks its
// JSON-RPC (tests/fake-codex-app-server.mjs) — no ChatGPT, no quota.
setupTempData();
process.env.CODEX_CLI = path.join(ROOT, "tests", "fake-codex-app-server.mjs");
delete process.env.ZEFF_WORK_HOST;

const until = async (what: string, ok: () => boolean, ms = 20000) => {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const driver = async () => {
  const { liveDriverFor } = await import("@/lib/work/live-driver");
  const d = liveDriverFor("codex");
  assert.ok(d, "Codex's driver is registered");
  return d;
};

/** A running run on a fresh todo, and its live session started through the driver (as the runner does). */
async function session(prompt: string, conversation: boolean, disallowedTools: string[] = ["mcp__zeff__report_time"]) {
  const { addSessionTodo } = await import("@/lib/boards/store");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const todo = addSessionTodo({ ticket: "", text: "Live Codex session test" });
  const run = createRun({ ticket: "", todoId: todo.id, mode: "instruct", provider: "codex", model: null, permissionMode: "ask", repo: null, prompt });
  updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
  await (await driver()).start({
    runId: run.id,
    conversation,
    elevated: false,
    effort: "",
    model: null,
    mode: "ask",
    allowBypass: false,
    askTimeoutMin: 0,
    cwd: ROOT,
    rules: "Antworte knapp.",
    prompt,
    name: "test",
    disallowedTools,
    resumeSession: null,
    newSessionId: null,
  });
  return run.id;
}

const view = async (id: number) => (await driver()).view(id);
const waitingFor = async (id: number, re: RegExp) => {
  const d = await driver();
  await until(`waiting: ${re}`, () => re.test(d.view(id)?.live.waiting ?? ""));
};
const doneRun = async (id: number) => {
  const { getRun } = await import("@/lib/work/store");
  await until("the run over", () => getRun(id)?.status !== "running");
  return getRun(id)!;
};

test("a conversation: it asks before a command, you allow, it waits; a message steers its turn; finishing ends it with its result", async () => {
  const d = await driver();
  const id = await session("ASK to run something", true);
  await until("its question", () => (d.view(id)?.session.asks.length ?? 0) > 0);
  const v = (await view(id))!;
  const ask = v.session.asks[0];
  assert.equal(ask.tool, "Bash");
  assert.equal(ask.input.command, "echo hi", "the command as meant, not its shell wrapper");
  assert.deepEqual(ask.suggestions, [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "echo hi" }] }], "always: the rule it proposes");
  assert.equal(v.session.provider, "codex");
  assert.equal(v.session.costUsd, null, "a subscription: no cost");
  assert.equal(v.session.sessionId, "thr-fake", "its thread is the session");
  assert.ok(v.session.modes.every((m) => m.id !== "full"), "full access only when allowed");
  await d.answer(id, ask.requestId, { behavior: "allow", always: true });
  await waitingFor(id, /Echo: ASK/);
  assert.equal(d.idle(id), true, "waiting for you: no worker held");
  await until("the models", () => d.view(id)?.session.models[0]?.value === "fake-codex");

  // While it works, your message goes into the running turn.
  await d.send(id, "SLOW down", []);
  const { readLog } = await import("@/lib/work/log");
  await until("working", () => readLog(id).lines.some((l) => l.k === "say" && /Working slowly/.test(l.text)));
  assert.equal(d.idle(id), false);
  await new Promise((r) => setTimeout(r, 600));
  await d.send(id, "more please", []);
  await waitingFor(id, /Steered: more please/);

  await d.finish(id);
  const run = await doneRun(id);
  assert.equal(run.status, "done");
  assert.equal(run.summary, "Fake Codex work done.");
  assert.equal(run.sessionId, "thr-fake");
  assert.equal(run.turns, 3);
  assert.equal(run.costUsd, null);

  // Its log, as the page shows it (readLog hands a Codex log to readCodexLog).
  const log = readLog(id);
  assert.equal(log.sessionId, "thr-fake");
  const lines = log.lines;
  assert.ok(!lines.some((l) => l.k === "you" && /ASK to run/.test(l.text)), "the prompt is the run's own, not a message of yours");
  assert.ok(lines.some((l) => l.k === "start" && l.model === "fake-codex"));
  assert.ok(lines.some((l) => l.k === "tool" && l.tool === "Bash" && l.text === "echo hi"));
  const asked = lines.find((l) => l.k === "ask");
  assert.ok(asked && asked.k === "ask" && asked.text === "Bash: echo hi" && asked.answer === "allowed — always", JSON.stringify(asked));
  assert.ok(lines.some((l) => l.k === "out" && l.text === "hi"));
  assert.ok(lines.some((l) => l.k === "say" && /Echo: ASK/.test(l.text)));
  assert.ok(lines.some((l) => l.k === "you" && l.text === "more please"));
  assert.ok(lines.some((l) => l.k === "note" && /finish/.test(l.text)));
  assert.equal(lines.filter((l) => l.k === "note" && l.text === "Turn done").length, 3);
  // Its booking tools left out of Zeff's MCP server.
  const { inPath } = await import("@/lib/work/log");
  const sent = (await import("node:fs")).readFileSync(inPath(id), "utf8");
  assert.match(sent, /"mcp_servers.zeff.disabled_tools":\["report_time"\]/);
  assert.doesNotMatch(sent, /"jsonrpc"/);
});

test("a task ends on its own when its result comes", async () => {
  const id = await session("RESULT please", false);
  const run = await doneRun(id);
  assert.equal(run.status, "done");
  assert.equal(run.summary, "Fake Codex work done.");
});

test("a file change and a question; Zeff restarting doesn't end the session; closed without a result", async () => {
  const d = await driver();
  const live = await import("@/plugins/codex-cli/live");
  const id = await session("EDIT a file", true, ["mcp__zeff__report_time", "Edit", "Write"]);
  await until("its question", () => (d.view(id)?.session.asks.length ?? 0) > 0);
  const ask = d.view(id)!.session.asks[0];
  assert.equal(ask.tool, "Edit");
  assert.deepEqual(ask.input, { file_path: "a.txt", old_string: "old line", new_string: "new line" });
  await d.answer(id, ask.requestId, { behavior: "deny" });
  await waitingFor(id, /Echo: EDIT/);
  const { readLog } = await import("@/lib/work/log");
  assert.ok(readLog(id).lines.some((l) => l.k === "ask" && l.text === "Edit: a.txt" && l.answer === "denied" && l.ok === false));
  assert.ok(readLog(id).lines.some((l) => l.k === "start" && /read-only|readOnly/.test(l.text)), "a run that only looks: the read-only sandbox");

  // A restart: the server forgets the session (its host goes on) and finds it again.
  live.codexLives.get(id)?.sock?.destroy();
  live.codexLives.delete(id);
  live.reattachCodexSessions([id]);
  await waitingFor(id, /Echo: EDIT/);
  await d.send(id, "QUESTION for you", []);
  await until("its question", () => d.view(id)?.session.asks[0]?.tool === "AskUserQuestion");
  const q = d.view(id)!.session.asks[0];
  assert.equal((q.input.questions as { question: string }[])[0].question, "Which one?");
  await d.answer(id, q.requestId, { behavior: "allow", answers: { "Which one?": "B" } });
  await waitingFor(id, /You chose B/);
  assert.ok(readLog(id).lines.some((l) => l.k === "ask" && l.answer === "Which one? → B"));

  await d.setMode(id, "read-only");
  await assert.rejects(d.setMode(id, "full"), /Bypass isn't allowed/);
  await d.close(id);
  const run = await doneRun(id);
  assert.equal(run.status, "done");
  assert.match(run.summary ?? "", /You chose B/);
  assert.equal(run.result, null, "closed: no result taken in");
});

test("a turn can be stopped", async () => {
  const d = await driver();
  const id = await session("SLOW work", true);
  const { readLog } = await import("@/lib/work/log");
  await until("working", () => readLog(id).lines.some((l) => l.k === "say" && /Working slowly/.test(l.text)));
  await d.interrupt(id);
  await until("stopped", () => d.view(id)?.live.waiting != null && d.view(id)?.live.busy === false);
  assert.ok(readLog(id).lines.some((l) => l.k === "note" && l.text === "Turn stopped"));
  const { cancelRun } = await import("@/lib/work/runner");
  cancelRun(id);
  const { getRun } = await import("@/lib/work/store");
  assert.equal(getRun(id)?.status, "cancelled");
});
