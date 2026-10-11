#!/usr/bin/env node
/**
 * A stand-in for `claude -p --input-format stream-json --output-format stream-json
 * --permission-prompt-tool stdio` (tests and snapshot UIs — no real Claude, no cost). It speaks
 * the same protocol: initialize, user turns, can_use_tool requests answered by the host,
 * interrupt, set_permission_mode, set_model.
 *
 * A turn's text decides what it does: "ASK" — it wants to run a Bash command and asks first;
 * "QUESTION" — AskUserQuestion; "SLOW" — works ~3 s (to interrupt); "RESULT" or Zeff's wrap-up
 * ("Schließ jetzt ab") — answers with the work result as JSON. Otherwise it just answers.
 */
import readline from "node:readline";

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const sessionId = flag("--resume") ?? flag("--session-id") ?? "fake-session";
let mode = flag("--permission-mode") === "manual" ? "default" : (flag("--permission-mode") ?? "default");
let model = flag("--model") ?? "fake-model";
let cost = 0;
let turns = 0;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const pending = new Map();
let req = 0;
let interrupted = false;

/** Ask the host (can_use_tool) and wait for its answer. */
const ask = (tool, input) =>
  new Promise((resolve) => {
    const id = `fake-${++req}`;
    pending.set(id, resolve);
    out({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: tool, input, permission_suggestions: [{ type: "addRules", rules: [{ toolName: tool, ruleContent: input.command ?? "" }], behavior: "allow", destination: "localSettings" }], tool_use_id: `tu-${id}` } });
  });
const say = (text) => out({ type: "assistant", message: { content: [{ type: "text", text }] }, session_id: sessionId });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = (subtype = "success", text = "") => {
  cost += 0.01;
  turns++;
  out({ type: "result", subtype, is_error: subtype !== "success", result: text, total_cost_usd: cost, num_turns: turns, session_id: sessionId, permission_denials: [] });
};

async function turn(text) {
  interrupted = false;
  out({ type: "system", subtype: "init", session_id: sessionId, model, cwd: process.cwd(), permissionMode: mode, slash_commands: ["review", "context"] });
  if (/SLOW/.test(text)) {
    say("Working slowly …");
    for (let i = 0; i < 100 && !interrupted; i++) await sleep(100);
    if (interrupted) return end("error_during_execution");
  }
  if (/ASK/.test(text)) {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "echo hi" } }] }, session_id: sessionId });
    const a = mode === "bypassPermissions" ? { behavior: "allow" } : await ask("Bash", { command: "echo hi", description: "Say hi" });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: a.behavior === "allow" ? "hi" : a.message, is_error: a.behavior !== "allow" }] } });
  }
  if (/QUESTION/.test(text)) {
    const a = await ask("AskUserQuestion", { questions: [{ question: "Which one?", header: "Pick", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] });
    say(`You chose ${a.updatedInput?.answers?.["Which one?"] ?? "nothing"}.`);
  }
  if (/RESULT|Schließ jetzt ab/.test(text)) {
    say(`Done.\n\n\`\`\`json\n${JSON.stringify({ outcome: "done", summary: "Fake work done.", entry: "Fake work", completedTodos: [], followUps: [] })}\n\`\`\``);
  } else say(`Echo: ${text.slice(0, 80)}`);
  end("success", "ok");
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
  if (m.type === "control_response") {
    const done = pending.get(m.response?.request_id);
    pending.delete(m.response?.request_id);
    done?.(m.response?.response ?? {});
    return;
  }
  if (m.type === "control_request") {
    const r = m.request ?? {};
    if (r.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: [{ name: "review", description: "Review", argumentHint: "" }], models: [{ value: "fake-model", displayName: "Fake", supportedEffortLevels: ["low", "high"] }] } } });
    else if (r.subtype === "interrupt") {
      interrupted = true;
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
    } else if (r.subtype === "set_permission_mode") {
      mode = r.mode;
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { mode } } });
      out({ type: "system", subtype: "status", permissionMode: mode, session_id: sessionId });
    } else if (r.subtype === "set_model") {
      model = r.model;
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
    } else out({ type: "control_response", response: { subtype: "error", request_id: m.request_id, error: `Unsupported control request subtype: ${r.subtype}` } });
    return;
  }
  if (m.type === "user") {
    // --replay-user-messages: your message back, as taken in.
    if (args.includes("--replay-user-messages")) out({ type: "user", isReplay: true, message: m.message, session_id: sessionId });
    const text = (m.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    queue = queue.then(() => turn(text));
  }
});
rl.on("close", () => queue.then(() => process.exit(0)));
