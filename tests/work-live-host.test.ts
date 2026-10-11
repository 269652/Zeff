import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test, { after } from "node:test";
import { ROOT, setupTempData } from "./helpers";

// A live Claude session on the launcher's work host (scripts/work-host.mjs, as the launcher runs it):
// started there, answered through it, kept open between turns, finished — with a fake CLI
// (tests/fake-claude-live.mjs) and a stand-in for Zeff's /api/work/exit.
const dir = setupTempData();
const FAKE = path.join(ROOT, "tests", "fake-claude-live.mjs");
const TOKEN = "live-t0ken";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
const until = async (what: string, ok: () => boolean, ms = 20000) => {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

let host: ChildProcess | null = null;
let zeff: http.Server | null = null;
const exits: number[] = [];
after(() => {
  host?.kill();
  zeff?.close();
});

async function startHost() {
  const zeffPort = await freePort();
  zeff = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      exits.push((JSON.parse(body) as { runId: number }).runId);
      res.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((r) => zeff!.listen(zeffPort, "127.0.0.1", () => r()));
  const port = await freePort();
  host = spawn(process.execPath, [path.join(ROOT, "scripts", "work-host.mjs")], {
    env: { ...process.env, ZEFF_WORK_PORT: String(port), ZEFF_URL: `http://127.0.0.1:${zeffPort}`, ZEFF_WORK_TOKEN: TOKEN, ZEFF_WORK_STATE: path.join(dir, "host-state.json"), ZEFF_WORK_IDLE_MS: "300" },
    stdio: "ignore",
  });
  process.env.ZEFF_WORK_HOST = `http://127.0.0.1:${port}`;
  process.env.ZEFF_WORK_TOKEN = TOKEN;
  const { workHostUp } = await import("@/lib/work/host");
  for (let i = 0; i < 100 && !(await workHostUp()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await workHostUp(), "the work host is up");
}

test("a conversation on the launcher's work host: asked, answered, open between turns, finished", async () => {
  await startHost();
  const { addSessionTodo } = await import("@/lib/boards/store");
  const { createRun, getRun, updateRun } = await import("@/lib/work/store");
  const live = await import("@/plugins/claude-cli/live");
  const todo = addSessionTodo({ ticket: "", text: "On the host" });
  const run = createRun({ ticket: "", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: "default", repo: null, prompt: "ASK first" });
  updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
  await live.startClaudeSession(
    { runId: run.id, conversation: true, elevated: false, effort: "", model: null, mode: "default", allowBypass: false, askTimeoutMin: 0, command: process.execPath, args: [FAKE, "--replay-user-messages"], cwd: ROOT, newSessionId: `h-${run.id}` },
    "ASK first",
  );
  assert.equal(live.readSessionCfg(run.id)?.transport, "launcher", "on the launcher's host");
  assert.ok(getRun(run.id)?.pid, "its pid kept");

  await until("its question", () => (live.claudeLiveView(run.id)?.session.asks.length ?? 0) > 0);
  const ask = live.claudeLiveView(run.id)!.session.asks[0];
  await live.answer(run.id, ask.requestId, { behavior: "allow" });
  await until("its turn over", () => live.claudeLiveView(run.id)?.live.waiting != null);

  // Open between turns (a conversation): longer than the host's idle time — and still taking messages.
  await new Promise((r) => setTimeout(r, 1000));
  await live.sendToClaude(run.id, "and more");
  await until("the next turn", () => /Echo: and more/.test(live.claudeLiveView(run.id)?.live.waiting ?? ""));

  // Its answer kept beside the log, shown with its question.
  const { readLog } = await import("@/lib/work/log");
  const asked = readLog(run.id).lines.find((l) => l.k === "ask");
  assert.ok(asked?.k === "ask" && asked.answer === "allowed", JSON.stringify(asked));

  await live.finishClaude(run.id);
  await until("done", () => getRun(run.id)?.status === "done");
  assert.equal(getRun(run.id)!.summary, "Fake work done.");
  // The host closed its input: the CLI quit, and the host reported it.
  await until("reported over", () => exits.includes(run.id));
});

test("a work host from before an update (no live features) isn't used: the session gets a host of its own", async () => {
  // A stand-in for an old host: healthy, but without `features`.
  const port = await freePort();
  const old = http.createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, children: 0 })));
  await new Promise<void>((r) => old.listen(port, "127.0.0.1", () => r()));
  const before = process.env.ZEFF_WORK_HOST;
  process.env.ZEFF_WORK_HOST = `http://127.0.0.1:${port}`;
  try {
    const { addSessionTodo } = await import("@/lib/boards/store");
    const { createRun, getRun, updateRun } = await import("@/lib/work/store");
    const live = await import("@/plugins/claude-cli/live");
    const todo = addSessionTodo({ ticket: "", text: "Old host" });
    const run = createRun({ ticket: "", todoId: todo.id, mode: "instruct", provider: "claude", model: null, permissionMode: "default", repo: null, prompt: "hello" });
    updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
    await live.startClaudeSession(
      { runId: run.id, conversation: true, elevated: false, effort: "", model: null, mode: "default", allowBypass: false, askTimeoutMin: 0, command: process.execPath, args: [FAKE, "--replay-user-messages"], cwd: ROOT, newSessionId: `o-${run.id}` },
      "hello",
    );
    assert.equal(live.readSessionCfg(run.id)?.transport, "own");
    await until("its answer", () => /Echo: hello/.test(live.claudeLiveView(run.id)?.live.waiting ?? ""));
    await live.closeClaude(run.id);
    await until("closed", () => getRun(run.id)?.status === "done");
  } finally {
    process.env.ZEFF_WORK_HOST = before;
    old.close();
  }
});

test("the work host restarts itself for new code once nothing runs on it", async () => {
  const fs = await import("node:fs");
  const script = path.join(ROOT, "scripts", "work-host.mjs");
  const port = await freePort();
  const proc = spawn(process.execPath, [script], { env: { ...process.env, ZEFF_WORK_PORT: String(port), ZEFF_URL: "http://127.0.0.1:9", ZEFF_WORK_TOKEN: TOKEN, ZEFF_WORK_STATE: path.join(dir, "host-state-2.json") }, stdio: "ignore" });
  let exited = false;
  proc.on("exit", () => (exited = true));
  await new Promise((r) => setTimeout(r, 1500));
  const now = new Date();
  fs.utimesSync(script, now, now); // "updated"
  await until("it ends (the launcher starts it again)", () => exited, 15000);
});
