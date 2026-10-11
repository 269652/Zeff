#!/usr/bin/env node
/**
 * A stand-in for `codex app-server` (tests — no ChatGPT, no quota): Codex's JSON-RPC over stdio,
 * a line each way, no "jsonrpc" member — initialize, thread/start or thread/resume, turn/start,
 * turn/steer, turn/interrupt; it asks through server requests and waits for their responses.
 *
 * A turn's text decides what it does: "ASK" — it wants to run a command and asks first; "EDIT" —
 * a file change it asks for; "QUESTION" — requestUserInput; "SLOW" — works ~3 s (to interrupt or
 * steer); "RESULT" or Zeff's wrap-up ("Schließ jetzt ab") — answers with the work result as a
 * ```json block. Otherwise it echoes. Started as `node fake-codex-app-server.mjs app-server`.
 */
import readline from "node:readline";

// `codex debug models` (the catalog codexModels() reads).
if (process.argv.includes("debug")) {
  process.stdout.write(JSON.stringify({ models: [{ slug: "fake-codex", display_name: "Fake Codex", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] }] }));
  process.exit(0);
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const note = (method, params) => out({ method, params });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let threadId = null;
let model = "fake-codex";
let turnNo = 0;
let active = null; // { id, interrupted, steered: [] }
let reqNo = 0;
const pending = new Map();

/** A server request — resolved with the client's result. */
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = reqNo++;
    pending.set(id, resolve);
    out({ method, id, params: { threadId, turnId: active.id, ...params } });
  });
const item = (it) => {
  note("item/started", { item: it, threadId, turnId: active.id });
  note("item/completed", { item: it, threadId, turnId: active.id });
};
const say = (text) => item({ type: "agentMessage", id: `msg-${Math.random().toString(36).slice(2)}`, text, phase: "final_answer" });
const userItem = (input) => item({ type: "userMessage", id: `u-${Math.random().toString(36).slice(2)}`, clientId: null, content: input });

async function turn(input) {
  const text = input.filter((i) => i.type === "text").map((i) => i.text).join("\n");
  note("turn/started", { threadId, turn: { id: active.id, items: [], status: "inProgress", error: null } });
  userItem(input);
  if (/SLOW/.test(text)) {
    say("Working slowly …");
    for (let i = 0; i < 30 && !active.interrupted; i++) await sleep(100);
  }
  if (!active.interrupted && /ASK/.test(text)) {
    const exec = { type: "commandExecution", id: "exec-1", command: `"powershell.exe" -Command 'echo hi'`, cwd: process.cwd(), status: "inProgress", commandActions: [{ type: "unknown", command: "echo hi" }], aggregatedOutput: null, exitCode: null };
    note("item/started", { item: exec, threadId, turnId: active.id });
    const r = await ask("item/commandExecution/requestApproval", { itemId: "exec-1", command: exec.command, cwd: exec.cwd, commandActions: exec.commandActions, proposedExecpolicyAmendment: ["echo", "hi"], availableDecisions: ["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["echo", "hi"] } }, "cancel"] });
    const ok = r.decision === "accept" || typeof r.decision === "object";
    note("item/completed", { item: { ...exec, status: ok ? "completed" : "declined", aggregatedOutput: ok ? "hi\n" : "", exitCode: ok ? 0 : null }, threadId, turnId: active.id });
  }
  if (!active.interrupted && /EDIT/.test(text)) {
    const change = { type: "fileChange", id: "patch-1", changes: [{ path: "a.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old line\n+new line\n" }], status: "inProgress" };
    note("item/started", { item: change, threadId, turnId: active.id });
    const r = await ask("item/fileChange/requestApproval", { itemId: "patch-1", reason: null });
    note("item/completed", { item: { ...change, status: r.decision === "accept" || r.decision === "acceptForSession" ? "completed" : "declined" }, threadId, turnId: active.id });
  }
  if (!active.interrupted && /QUESTION/.test(text)) {
    const r = await ask("item/tool/requestUserInput", { itemId: "q-1", isBlocking: true, autoResolutionMs: null, questions: [{ id: "pick", header: "Pick", question: "Which one?", isOther: true, isSecret: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }] });
    say(`You chose ${r.answers?.pick?.answers?.[0] ?? "nothing"}.`);
  }
  for (const s of active.steered) say(`Steered: ${s}`);
  if (active.interrupted) {
    note("turn/completed", { threadId, turn: { id: active.id, items: [], status: "interrupted", error: null } });
  } else {
    if (/RESULT|Schließ jetzt ab/.test(text)) say(`Done.\n\n\`\`\`json\n${JSON.stringify({ outcome: "done", summary: "Fake Codex work done.", entry: "Fake work", completedTodos: [], followUps: [] })}\n\`\`\``);
    else say(`Echo: ${text.slice(0, 80)}`);
    note("turn/completed", { threadId, turn: { id: active.id, items: [], status: "completed", error: null } });
  }
  active = null;
}

let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.jsonrpc) return out({ id: m.id, error: { code: -32600, message: "unexpected jsonrpc member" } });
  if (m.id !== undefined && !m.method) {
    const done = pending.get(m.id);
    pending.delete(m.id);
    if (done) note("serverRequest/resolved", { threadId, requestId: m.id });
    return done?.(m.result ?? {});
  }
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      return out({ id: m.id, result: { userAgent: "fake", platformFamily: "windows", platformOs: "windows" } });
    case "initialized":
      return;
    case "thread/start":
    case "thread/resume": {
      if (m.method === "thread/resume" && !p.threadId) return out({ id: m.id, error: { code: -32602, message: "no thread" } });
      threadId = p.threadId ?? "thr-fake";
      model = p.model ?? model;
      const sandbox = { "read-only": { type: "readOnly" }, "workspace-write": { type: "workspaceWrite" }, "danger-full-access": { type: "dangerFullAccess" } }[p.sandbox] ?? { type: "readOnly" };
      out({ id: m.id, result: { thread: { id: threadId, cwd: p.cwd, turns: [] }, model, cwd: p.cwd, approvalPolicy: p.approvalPolicy, sandbox, reasoningEffort: null, config: p.config } });
      return note("thread/started", { thread: { id: threadId } });
    }
    case "turn/start": {
      if (p.threadId !== threadId) return out({ id: m.id, error: { code: -32602, message: "unknown thread" } });
      if (p.model) model = p.model;
      const t = { id: `turn-${++turnNo}`, interrupted: false, steered: [] };
      out({ id: m.id, result: { turn: { id: t.id, items: [], status: "inProgress", error: null } } });
      queue = queue.then(() => {
        active = t;
        return turn(p.input ?? []);
      });
      return;
    }
    case "turn/steer": {
      if (!active || active.id !== p.expectedTurnId) return out({ id: m.id, error: { code: -32600, message: "no active turn to steer" } });
      const text = (p.input ?? []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
      active.steered.push(text);
      userItem(p.input ?? []);
      return out({ id: m.id, result: { turnId: active.id } });
    }
    case "turn/interrupt":
      if (active && active.id === p.turnId) active.interrupted = true;
      return out({ id: m.id, result: {} });
    default:
      return out({ id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  }
});
rl.on("close", () => queue.then(() => process.exit(0)));
