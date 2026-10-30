#!/usr/bin/env node
/**
 * The AI CLI every test gets unless it sets its own (tests/helpers.ts setupTempData: CLAUDE_CLI, CODEX_CLI, COPILOT_CLI):
 * no test may ever start a real Claude, Codex or Copilot (cost, your login, your files). Started anyway, it fails loudly.
 */
const msg =
  `fake-cli-fail: a test started an AI CLI (${process.argv.slice(2).join(" ").slice(0, 200)}) without a fake of its own — ` +
  "set CLAUDE_CLI / CODEX_CLI / COPILOT_CLI to one of tests/fake-*.mjs in that test.";
process.stderr.write(`${msg}\n`);
process.stdout.write(`${JSON.stringify({ type: "result", subtype: "error", is_error: true, result: msg })}\n`);
process.exit(97);
