import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ROOT } from "./helpers";

// The page's one ✨ entry: a composer whose chips (Think along, Write, Ask about this page) decide what typed text does — and the
// fake AI a test server can be started with (its e2e tests), never a real one.

test("the chips decide: Think along (the default when nothing is typed), Write (a mode, or what was typed), Ask; typed text alone asks", async () => {
  const { routeAiEntry } = await import("@/plugins/workspace/ai-entry");
  assert.deepEqual(routeAiEntry("", null), { kind: "think", wish: "" }, "nothing typed, no chip: Think along");
  assert.deepEqual(routeAiEntry("  ", null), { kind: "think", wish: "" });
  assert.deepEqual(routeAiEntry("Plan the trip", "think"), { kind: "think", wish: "Plan the trip" }, "typed with Think along: its wish");
  assert.deepEqual(routeAiEntry("", "write"), { kind: "write", mode: "continue" }, "Write without text: the chosen mode (continue by default)");
  assert.deepEqual(routeAiEntry("", "write", "summarize"), { kind: "write", mode: "summarize" });
  assert.deepEqual(routeAiEntry(" An agenda ", "write", "summarize"), { kind: "write", mode: "custom", instruction: "An agenda" }, "typed with Write: written as told");
  assert.deepEqual(routeAiEntry("What is open?", "ask"), { kind: "ask", question: "What is open?" });
  assert.equal(routeAiEntry("", "ask"), null, "Ask needs a question");
  assert.deepEqual(routeAiEntry("What is open?", null), { kind: "ask", question: "What is open?" }, "typed text alone: asked");
});

test("an answer short enough stays in the composer; a longer one goes to the chat panel", async () => {
  const { answerFits, ANSWER_INLINE_MAX } = await import("@/plugins/workspace/ai-entry");
  assert.ok(answerFits("Two things are open."));
  assert.ok(!answerFits("x".repeat(ANSWER_INLINE_MAX + 1)));
  assert.ok(!answerFits(Array.from({ length: 12 }, (_, i) => `- line ${i}`).join("\n")), "many lines: the chat");
});

test("the fake CLI answers with FAKE_CLAUDE_OUTPUT_FILE, read at each call (a test changes it between steps)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-fake-ai-"));
  const file = path.join(dir, "out.json");
  const call = () => JSON.parse(spawnSync(process.execPath, [path.join(ROOT, "tests", "fake-claude-json.mjs")], { input: "prompt", encoding: "utf8", env: { ...process.env, FAKE_CLAUDE_OUTPUT: "", FAKE_CLAUDE_OUTPUT_FILE: file } }).stdout);
  fs.writeFileSync(file, JSON.stringify({ text: "eins" }));
  assert.equal(call().structured_output.text, "eins");
  fs.writeFileSync(file, JSON.stringify({ text: "zwei" }));
  assert.equal(call().result, "zwei");
  fs.rmSync(file);
  assert.deepEqual(call().structured_output, {}, "no file yet: an empty answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a test server started with --fake-ai gets the fake CLI and its output file; without it no AI CLI at all", async () => {
  const { testEnv } = await import("../scripts/test-server.mjs");
  const dir = path.join(os.tmpdir(), "zeff-test-server-x");
  const plain = testEnv(dir, ".next-e2e");
  assert.match(plain.CLAUDE_CLI ?? "", /no-ai-cli/);
  assert.equal(plain.FAKE_CLAUDE_OUTPUT_FILE, undefined);
  const fake = testEnv(dir, ".next-e2e", { fakeAi: true });
  assert.equal(fake.CLAUDE_CLI, path.join(ROOT, "tests", "fake-claude-json.mjs"));
  assert.equal(fake.FAKE_CLAUDE_OUTPUT_FILE, path.join(dir, "fake-ai-output.json"));
  assert.equal(fake.ZEFF_FAKE_AI, "1", "the seed installs the AI plugins for it");
  assert.match(fake.CODEX_CLI ?? "", /no-ai-cli/, "the other CLIs stay unreachable");
});
