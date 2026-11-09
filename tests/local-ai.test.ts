import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The local AI: a model on this computer through Ollama's own API (its context window set, the answer held to the schema)
 * or any OpenAI-compatible server; as the default AI, and — with "secret only to the local AI" — the one a prompt with
 * secret lines goes to, whole, instead of a cloud AI without them.
 */

type Seen = { path: string; body: Record<string, unknown> };

/** A fake Ollama (or, `openai`, an OpenAI-compatible server) that answers every prompt with `answer`. */
async function fakeServer(kind: "ollama" | "openai", answer: string): Promise<{ url: string; seen: Seen[]; close: () => void }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const json = (v: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (kind === "ollama" && req.url === "/api/tags") return json({ models: [{ name: "qwen3:8b" }, { name: "llama3.2:3b" }] });
      if (kind === "openai" && req.url === "/v1/models") return json({ data: [{ id: "local-model" }] });
      if (req.method === "POST") {
        seen.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
        if (req.url === "/api/chat") return json({ message: { content: `<think>hm</think>${answer}` }, prompt_eval_count: 12, eval_count: 3 });
        if (req.url === "/v1/chat/completions") return json({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
      }
      json({ error: "not found" }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => server.close() };
}

const SCHEMA = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };

test("Ollama: its own API, a large context, the schema as its format; the model's thoughts left out", async () => {
  const s = await fakeServer("ollama", '{"ok": true}');
  try {
    const { runLocal } = await import("@/plugins/local-ai/client");
    const r = await runLocal<{ ok: boolean }>("Frage", SCHEMA, { config: { url: s.url, model: "", secretLocal: true } });
    assert.deepEqual(r.output, { ok: true });
    assert.equal(r.model, "qwen3:8b", "the server's first model");
    assert.equal(r.costUsd, 0);
    assert.equal(s.seen[0].path, "/api/chat");
    assert.deepEqual(s.seen[0].body.format, SCHEMA);
    assert.equal((s.seen[0].body.options as { num_ctx: number }).num_ctx, 32768);
  } finally {
    s.close();
  }
});

test("an OpenAI-compatible server (LM Studio): chat completions with a JSON schema; no JSON is a NoJsonError", async () => {
  const s = await fakeServer("openai", '{"ok": true}');
  const bad = await fakeServer("openai", "Sure! Here you go.");
  try {
    const { runLocal } = await import("@/plugins/local-ai/client");
    const r = await runLocal<{ ok: boolean }>("Frage", SCHEMA, { config: { url: s.url, model: "local-model", secretLocal: true } });
    assert.deepEqual(r.output, { ok: true });
    assert.equal(s.seen[0].path, "/v1/chat/completions");
    assert.equal((s.seen[0].body.response_format as { type: string }).type, "json_schema");
    const { NoJsonError } = await import("@/lib/ai/json");
    await assert.rejects(() => runLocal("Frage", SCHEMA, { config: { url: bad.url, model: "", secretLocal: true } }), (e) => e instanceof NoJsonError);
  } finally {
    s.close();
    bad.close();
  }
});

test("the LLM layer: the local AI as the default; a prompt with secret lines goes to it whole, never to a cloud AI", async () => {
  const s = await fakeServer("ollama", '{"ok": true}');
  try {
    const { setInstalled } = await import("@/plugins/state");
    for (const id of ["llm", "local-ai", "claude-cli"]) setInstalled(id, true);
    const { saveLocalAiConfig } = await import("@/plugins/local-ai/config");
    saveLocalAiConfig({ url: s.url, model: "llama3.2:3b", secretLocal: true });
    const { updateAppSettings, runAi } = await import("@/lib/ai");

    // The default: everything goes to it.
    updateAppSettings({ aiProvider: "local" });
    const r = await runAi<{ ok: boolean }>("Wie geht es?", SCHEMA, { fresh: true });
    assert.equal(r.model, "llama3.2:3b");
    assert.equal(s.seen.length, 1);

    // Claude by default — but a secret line in the prompt: the local AI reads it, whole.
    updateAppSettings({ aiProvider: "claude" });
    const { setSourceLabel } = await import("@/lib/boundaries");
    setSourceLabel("notes", "secret");
    const { getDb, schema } = await import("@/db");
    const line = "Kontostand Sparkasse: 12.345,67 Euro am Monatsende";
    getDb().insert(schema.contexts).values({ kind: "note", body: line }).run();
    const r2 = await runAi<{ ok: boolean }>(`Was ist zu tun?\n${line}\nSonst nichts.`, SCHEMA, { fresh: true });
    assert.deepEqual(r2.output, { ok: true });
    assert.equal(s.seen.length, 2, "went to the local AI");
    const sent = String((s.seen[1].body.messages as { content: string }[])[0].content);
    assert.ok(sent.includes(line), "with the secret line in it");
  } finally {
    s.close();
  }
});
