#!/usr/bin/env node
/**
 * A stand-in for `claude -p --output-format json --json-schema …` (tests — no Claude, no cost):
 * reads the prompt from stdin (to FAKE_CLAUDE_PROMPT_FILE, if set) and answers with
 * FAKE_CLAUDE_OUTPUT (JSON) as its structured output.
 */
import fs from "node:fs";

let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_CLAUDE_PROMPT_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PROMPT_FILE, prompt);
  const output = JSON.parse(process.env.FAKE_CLAUDE_OUTPUT ?? "{}");
  // FAKE_CLAUDE_DELAY_MS: answers late (a hung run, for the tests that stop one).
  setTimeout(() => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", result: typeof output.text === "string" ? output.text : "", structured_output: output, total_cost_usd: 0.001 })), Number(process.env.FAKE_CLAUDE_DELAY_MS) || 0);
});
