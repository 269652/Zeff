import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodex, strictSchema, unstrict } from "../src/plugins/codex-cli/cli";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, note: { type: "string" }, closed: { type: "boolean" }, list: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, why: { type: "string" } }, required: ["id"] } } },
  required: ["answer", "closed"],
};

/** OpenAI's strict structured outputs: every object closed, every property required — the optional ones nullable. */
test("a schema made strict for Codex, and its answer back in the original's shape", () => {
  const s = strictSchema(SCHEMA) as unknown as { additionalProperties: boolean; required: string[]; properties: Record<string, { type: unknown; items?: { required: string[]; additionalProperties: boolean } }> };
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required, ["answer", "note", "closed", "list"]);
  assert.deepEqual(s.properties.note.type, ["string", "null"]);
  assert.deepEqual(s.properties.list.items?.required, ["id", "why"]);
  assert.equal(s.properties.list.items?.additionalProperties, false);
  // An optional property that came as null is left out again; a required one stays.
  assert.deepEqual(unstrict({ answer: "a", note: null, closed: true, list: [{ id: 1, why: null }] }, SCHEMA), { answer: "a", closed: true, list: [{ id: 1 }] });
});

/** A run: the prompt on stdin, read-only and closed, the last agent message as the answer; a 401 as "not signed in". */
test("runCodex reads the answer from the events and says when it isn't signed in", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-codex-test-"));
  const argsFile = path.join(dir, "args.json");
  process.env.CODEX_CLI = path.join(ROOT, "tests", "fake-codex.mjs");
  process.env.FAKE_CODEX_ARGS = argsFile;
  try {
    process.env.FAKE_CODEX = "ok";
    const r = await runCodex<{ answer: string; note?: string; closed: boolean }>("hello", SCHEMA, { model: "gpt-5.5", timeoutMs: 30000 });
    assert.deepEqual(r.output, { answer: "got 5 chars", closed: true });
    assert.equal(r.model, "gpt-5.5");
    assert.equal(r.costUsd, null);
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    for (const a of ["exec", "--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check"]) assert.ok(args.includes(a), a);
    assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(args[args.indexOf("-m") + 1], "gpt-5.5");
    assert.equal(args.at(-1), "-");
    // Its schema file is gone afterwards.
    assert.equal(fs.existsSync(args[args.indexOf("--output-schema") + 1]), false);

    process.env.FAKE_CODEX = "unauthorized";
    await assert.rejects(runCodex("hello", SCHEMA, { timeoutMs: 30000 }), /isn't signed in — run `codex login`/);
  } finally {
    delete process.env.CODEX_CLI;
    delete process.env.FAKE_CODEX;
    delete process.env.FAKE_CODEX_ARGS;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Auto's hint says the truth when Codex's Windows sandbox isn't set up (it asks for every command then). */
test("Auto's hint names a missing Windows sandbox", async () => {
  const { codexModes } = await import("../src/plugins/codex-cli/live");
  const cache = globalThis as { __zeffCodexSandbox?: { at: number; state: string } };
  const auto = () => codexModes(false).find((m) => m.id === "agent")!.hint;
  try {
    cache.__zeffCodexSandbox = { at: Date.now(), state: "ready" };
    assert.doesNotMatch(auto(), /sandbox/i);
    cache.__zeffCodexSandbox = { at: Date.now(), state: "notConfigured" };
    if (process.platform === "win32") assert.match(auto(), /Windows sandbox isn't set up/);
  } finally {
    delete cache.__zeffCodexSandbox;
  }
});
