#!/usr/bin/env node
// A stand-in for OpenAI's Codex CLI in tests: `exec --json … -` reads the prompt from stdin and
// prints its events as JSONL. FAKE_CODEX: "ok" (the answer as JSON, an optional field as null),
// "unauthorized" (a 401, as when not signed in). Writes the arguments it got to FAKE_CODEX_ARGS.
import fs from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_CODEX_ARGS) fs.writeFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify(args));
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  out({ type: "thread.started", thread_id: "thread-1" });
  out({ type: "turn.started" });
  if (process.env.FAKE_CODEX === "unauthorized") {
    out({ type: "error", message: "Reconnecting... 1/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header)" });
    out({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header" } });
    return;
  }
  const schema = JSON.parse(fs.readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
  out({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } });
  out({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: JSON.stringify({ answer: `got ${prompt.length} chars`, note: null, closed: schema.additionalProperties === false }) } });
  out({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
});
