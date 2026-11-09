/**
 * The local AI's client: a prompt answered as JSON by a model on this computer. Ollama through its own API (the context
 * window set large enough for Zeff's prompts — its default cuts them off silently — and the answer held to the schema);
 * anything else (LM Studio, llama.cpp, vLLM …) through the OpenAI-compatible API. Nothing but this server is asked.
 * Server only.
 */
import type { AiAnswer } from "@/lib/ai/shared";
import { jsonIn, NoJsonError } from "@/lib/ai/json";
import { ABORTED, onAbort } from "@/lib/abort";
import { localAiConfig, type LocalAiConfig } from "./config";

/** The context window asked of Ollama: Zeff's prompts (a briefing, a day of mail) run to tens of thousands of tokens. */
export const OLLAMA_CONTEXT = 32768;
const DEFAULT_TIMEOUT_MS = 10 * 60000;

export type LocalServer = { kind: "ollama" | "openai"; models: string[] };

const join = (base: string, p: string) => `${base.replace(/\/+$/, "")}${p}`;

async function getJson(url: string, timeoutMs = 4000): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** What answers at the address: Ollama (its own API) or an OpenAI-compatible server, and its models. Throws when nothing does. */
export async function probeLocalServer(url = localAiConfig().url): Promise<LocalServer> {
  try {
    const v = (await getJson(join(url, "/api/tags"))) as { models?: { name?: string; model?: string }[] };
    if (Array.isArray(v.models)) return { kind: "ollama", models: v.models.map((m) => String(m.name ?? m.model ?? "")).filter(Boolean) };
  } catch {
    // not Ollama — perhaps an OpenAI-compatible server
  }
  const v = (await getJson(join(url, "/v1/models"))) as { data?: { id?: string }[] };
  if (!Array.isArray(v.data)) throw new Error("no models list");
  return { kind: "openai", models: v.data.map((m) => String(m.id ?? "")).filter(Boolean) };
}

/** The server found at an address is remembered a minute (every call would otherwise ask it first). */
const known = globalThis as { __zeffLocalServer?: { url: string; at: number; server: LocalServer } };
async function serverAt(url: string): Promise<LocalServer> {
  const hit = known.__zeffLocalServer;
  if (hit && hit.url === url && Date.now() - hit.at < 60000) return hit.server;
  const server = await probeLocalServer(url);
  known.__zeffLocalServer = { url, at: Date.now(), server };
  return server;
}

const INSTRUCTION = "Antworte ausschließlich mit einem einzigen JSON-Objekt nach diesem JSON-Schema — ohne Markdown, ohne Erklärung davor oder danach:";

/**
 * A prompt answered as JSON matching `schema` by the local model (`model`, else the one set, else the server's first).
 * No JSON in the answer: NoJsonError (the LLM layer asks once more). Stopped with the step it runs in.
 */
export async function runLocal<T>(prompt: string, schema: object, opts: { model?: string; timeoutMs?: number; config?: LocalAiConfig } = {}): Promise<AiAnswer<T>> {
  const cfg = opts.config ?? localAiConfig();
  let server: LocalServer;
  try {
    server = await serverAt(cfg.url);
  } catch {
    throw new Error(`The local AI doesn't answer at ${cfg.url} — start Ollama or LM Studio (Settings → Local AI).`);
  }
  const model = opts.model || cfg.model || server.models[0];
  if (!model) throw new Error(`The local AI at ${cfg.url} has no model yet — e.g. ollama pull qwen3:8b.`);
  const full = `${prompt}\n\n${INSTRUCTION}\n${JSON.stringify(schema)}`;
  const stop = new AbortController();
  const off = onAbort(() => stop.abort());
  const timer = setTimeout(() => stop.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const post = (p: string, body: object) =>
      fetch(join(cfg.url, p), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: stop.signal });
    let text = "";
    let usage: AiAnswer<T>["usage"];
    if (server.kind === "ollama") {
      const r = await post("/api/chat", { model, stream: false, format: schema, options: { num_ctx: OLLAMA_CONTEXT, temperature: 0 }, messages: [{ role: "user", content: full }] });
      if (!r.ok) throw new Error(`Ollama: ${r.status} ${(await r.text()).slice(0, 300)}`);
      const v = (await r.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      text = v.message?.content ?? "";
      usage = { input: v.prompt_eval_count ?? 0, output: v.eval_count ?? 0, cacheRead: 0, cacheWrite: 0 };
    } else {
      const ask = (format: object | null) =>
        post("/v1/chat/completions", { model, temperature: 0, messages: [{ role: "user", content: full }], ...(format ? { response_format: format } : {}) });
      let r = await ask({ type: "json_schema", json_schema: { name: "answer", schema } });
      // A server that doesn't take a schema: the instruction in the prompt has to do.
      if (r.status === 400 || r.status === 422) r = await ask(null);
      if (!r.ok) throw new Error(`Local AI: ${r.status} ${(await r.text()).slice(0, 300)}`);
      const v = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      text = v.choices?.[0]?.message?.content ?? "";
      usage = { input: v.usage?.prompt_tokens ?? 0, output: v.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 };
    }
    // (A reasoning model's thoughts first: the JSON is what follows them.)
    const answer = text.replace(/<think>[\s\S]*?<\/think>/g, "");
    let output: T;
    try {
      output = jsonIn(answer) as T;
    } catch {
      throw new NoJsonError(`The local AI (${model}) answered without JSON: ${answer.slice(0, 200)}`);
    }
    return { output, model, costUsd: 0, durationMs: Date.now() - started, usage };
  } catch (e) {
    if (stop.signal.aborted && !(e instanceof NoJsonError)) throw new Error(Date.now() - started >= (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) - 50 ? `The local AI (${model}) took too long.` : ABORTED);
    throw e;
  } finally {
    clearTimeout(timer);
    off();
  }
}
