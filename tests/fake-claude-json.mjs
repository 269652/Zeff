#!/usr/bin/env node
/**
 * A stand-in for `claude -p --output-format json --json-schema …` (tests — no Claude, no cost):
 * reads the prompt from stdin (to FAKE_CLAUDE_PROMPT_FILE, if set) and answers with
 * FAKE_CLAUDE_OUTPUT (JSON) as its structured output — or with the JSON in FAKE_CLAUDE_OUTPUT_FILE, read at each call
 * (a test server started with --fake-ai: its e2e tests write the answer before each step; no file yet: {}).
 */
import fs from "node:fs";

const answer = () => {
  const file = process.env.FAKE_CLAUDE_OUTPUT_FILE;
  if (file) return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
  return process.env.FAKE_CLAUDE_OUTPUT ?? "{}";
};

let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_CLAUDE_PROMPT_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PROMPT_FILE, prompt);
  const output = JSON.parse(answer());
  // FAKE_CLAUDE_DELAY_MS: answers late (a hung run, for the tests that stop one).
  setTimeout(() => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", result: typeof output.text === "string" ? output.text : "", structured_output: output, total_cost_usd: 0.001 })), Number(process.env.FAKE_CLAUDE_DELAY_MS) || 0);
});
