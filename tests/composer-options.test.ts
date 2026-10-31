import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { effortsOf } from "../src/lib/work/composer-shared";
import { ROOT, setupTempData } from "./helpers";

setupTempData();
// Codex stand-in: found on the "machine", with a small model catalog.
process.env.CODEX_CLI = path.join(ROOT, "tests", "fake-codex.mjs");

/** A model that names its efforts takes only those; one that names none takes all of Zeff's. */
test("the effort levels of a model", () => {
  assert.deepEqual(effortsOf({ efforts: ["low", "medium", "high"] }), ["", "low", "medium", "high"]);
  assert.deepEqual(effortsOf({ efforts: ["low", "ultra"] }), ["", "low"]);
  assert.deepEqual(effortsOf(undefined), ["", "low", "medium", "high", "xhigh", "max"]);
});

/** What the composer offers per backend: ChatGPT with its own modes and no Claude model in sight. */
test("each live backend has its own choices; ChatGPT workers need the plugin and live sessions", async () => {
  const { composerOptions } = await import("../src/lib/work/composer-options");
  const { setInstalled } = await import("../src/plugins/state");
  const { updateClaudeSessionSettings } = await import("../src/lib/work/store");

  setInstalled("codex-cli", true);
  setInstalled("claude-cli", true);
  updateClaudeSessionSettings({ live: true });
  // The page never waits for the CLI's catalog (codexModelsNow: what is cached, refreshed behind it): fetched once first.
  await (await import("../src/plugins/codex-cli/cli")).codexModels();
  let o = await composerOptions();
  assert.ok(o.providers.some((p) => p.id === "codex" && p.live), "ChatGPT offered as a live backend");
  const codex = o.choices.codex;
  assert.deepEqual(codex.modes.map((m) => m.id), ["ask", "agent", "read-only"]);
  assert.equal(codex.defaultMode, "ask");
  assert.deepEqual(codex.models.map((m) => m.value), ["", "gpt-6-luna"], "its own default first, then the visible models");
  assert.deepEqual(effortsOf(codex.models[1]), ["", "low", "medium", "high"], "a level Zeff doesn't know isn't offered");
  assert.ok(!codex.models.some((m) => /sonnet|opus|haiku/.test(m.value)), "no Claude model among ChatGPT's");
  assert.ok(o.choices.claude.models.some((m) => m.value === "sonnet"));
  assert.ok(codex.modes.every((m) => m.id !== o.choices.claude.defaultMode));

  // Without live sessions ChatGPT can't run a worker: not offered.
  updateClaudeSessionSettings({ live: false });
  o = await composerOptions();
  assert.ok(!o.providers.some((p) => p.id === "codex"));
  assert.equal(o.choices.codex, undefined);
});
