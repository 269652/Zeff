import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// A conversation on another provider (Codex) goes on through the runner like Claude's: its next
// message resumes the thread the run before it ended with — the runner isn't Claude-only.
setupTempData();
process.env.CODEX_CLI = path.join(ROOT, "tests", "fake-codex-app-server.mjs");
delete process.env.ZEFF_WORK_HOST;

const until = async (what: string, ok: () => boolean, ms = 20000) => {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("a Codex session's next message resumes its thread (and Claude-only rules stay Claude's)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("codex-cli", true);
  const { addSessionTodo } = await import("@/lib/todos/store");
  const { dispatchTodo } = await import("@/lib/work/runner");
  const { getRun } = await import("@/lib/work/store");
  const { liveDriverFor } = await import("@/lib/work/live-driver");
  const { workDir } = await import("@/lib/work/log");
  const d = liveDriverFor("codex")!;
  const cfgOf = (id: number) => JSON.parse(fs.readFileSync(path.join(workDir(), "sessions", `${id}.codex.json`), "utf8")) as { resumeSession: string | null };

  const todo = addSessionTodo({ ticket: "", text: "A Codex conversation" });
  const first = dispatchTodo(todo.id, { provider: "codex", instruction: "Say hello", conversation: true, session: {} });
  assert.equal(first.provider, "codex");
  await until("its thread", () => d.view(first.id)?.session.sessionId === "thr-fake");
  await until("its turn over", () => d.view(first.id)?.live.waiting != null);
  assert.equal(cfgOf(first.id).resumeSession, null, "a new conversation starts a thread");
  assert.equal(getRun(first.id)!.sessionId, null, "Zeff hands Codex no id: it reports its own");

  await d.finish(first.id);
  await until("the first run over", () => getRun(first.id)?.status !== "running");
  assert.equal(getRun(first.id)!.sessionId, "thr-fake", "the thread, kept for going on");

  // The next message: the same provider (not the default), the same thread.
  const second = dispatchTodo(todo.id, { instruction: "And again", continueRun: first.id, conversation: true, session: {} });
  assert.equal(second.provider, "codex");
  assert.equal(second.sessionId, "thr-fake");
  await until("its session", () => d.has(second.id) && !!d.view(second.id));
  assert.equal(cfgOf(second.id).resumeSession, "thr-fake", "resumed, not started again");
  await d.kill(second.id);
});
