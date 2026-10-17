import { execFile, spawn } from "node:child_process";
import { ABORTED, killTree, onAbort } from "@/lib/abort";
import { jsonIn, NoJsonError } from "@/lib/ai/json";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiAnswer } from "@/lib/ai/shared";
import { npmToolDirs } from "@/lib/node-tools";

/** How to start OpenAI's Codex CLI (ChatGPT): a program and the arguments before ours. */
export type CodexCommand = { command: string; args: string[]; where: string };

/**
 * Where OpenAI's Codex CLI is: CODEX_CLI (its .js entry, or a program), else the npm package's
 * entry next to a PATH entry (started with node — a .cmd can't be started without a shell), else
 * codex(.exe) on the PATH.
 */
export function findCodexCli(): CodexCommand | null {
  const own = process.env.CODEX_CLI?.trim();
  if (own && fs.existsSync(/*turbopackIgnore: true*/ own)) return /\.(c|m)?js$/.test(own) ? { command: process.execPath, args: [own], where: own } : { command: own, args: [], where: own };
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  // (+ Zeff's own npm folder, where the setup installs it)
  for (const dir of [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...npmToolDirs()]) {
    const pkgDir = path.join(dir, "node_modules", "@openai", "codex");
    try {
      const pkg = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(pkgDir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.codex;
      if (entry) {
        const file = path.join(pkgDir, entry);
        return { command: process.execPath, args: [file], where: file };
      }
    } catch {
      // not here
    }
    const program = path.join(dir, exe);
    if (fs.existsSync(/*turbopackIgnore: true*/ program)) return { command: program, args: [], where: program };
  }
  return null;
}

/** A model the Codex CLI offers: its id, its name, the reasoning efforts it takes. */
export type CodexModel = { id: string; label: string; efforts: string[] };

/**
 * The models the Codex CLI offers your ChatGPT account — its catalog (`codex debug models`, read
 * locally; asked once an hour). Empty when the CLI isn't there or says nothing usable.
 */
/** The models for a page: what is cached at once (stale too), and a refresh in the background — never a wait for the CLI. */
export function codexModelsNow(): CodexModel[] {
  const cache = globalThis as { __zeffCodexModels?: { at: number; list: CodexModel[] } };
  void codexModels().catch(() => {});
  return cache.__zeffCodexModels?.list ?? [];
}

export async function codexModels(): Promise<CodexModel[]> {
  const cache = globalThis as { __zeffCodexModels?: { at: number; list: CodexModel[] } };
  const hit = cache.__zeffCodexModels;
  if (hit && Date.now() - hit.at < (hit.list.length ? 3600000 : 600000)) return hit.list;
  const cli = findCodexCli();
  if (!cli) return [];
  const out = await new Promise<string>((resolve) =>
    execFile(
      /*turbopackIgnore: true*/ cli.command,
      [...cli.args, "debug", "models"],
      { cwd: os.tmpdir(), timeout: 30000, windowsHide: true, maxBuffer: 16_000_000 },
      (err, stdout) => resolve(err ? "" : String(stdout)),
    ),
  );
  let list: CodexModel[] = [];
  try {
    const j = JSON.parse(out) as { models?: unknown[] } | unknown[];
    const raw = (Array.isArray(j) ? j : (j.models ?? [])) as Record<string, unknown>[];
    list = raw
      .filter((m) => (m.visibility ?? "list") === "list" && typeof (m.slug ?? m.id) === "string")
      .map((m) => ({
        id: String(m.slug ?? m.id),
        label: String(m.display_name ?? m.displayName ?? m.slug ?? m.id),
        efforts: ((m.supported_reasoning_levels ?? m.supportedReasoningEfforts ?? []) as unknown[]).map((x) => String((x as { effort?: string })?.effort ?? x)),
      }));
  } catch {
    list = [];
  }
  cache.__zeffCodexModels = { at: Date.now(), list };
  return list;
}

/**
 * Whether Codex's Windows sandbox is set up (its app-server's windowsSandbox/readiness). Without
 * it a command can't run "in its folder on its own": Codex asks for every one, so Auto behaves like
 * Ask. Only on Windows; "unknown" until asked (a warm cache for ten minutes, refreshed by the pages).
 */
export type CodexSandbox = "ready" | "notConfigured" | "updateRequired" | "unknown";
const sandboxCache = globalThis as { __zeffCodexSandbox?: { at: number; state: CodexSandbox } };

/** The last answer (sync, for the mode texts): unknown when never asked or not on Windows. */
export const codexSandboxState = (): CodexSandbox => (process.platform === "win32" ? (sandboxCache.__zeffCodexSandbox?.state ?? "unknown") : "ready");

export async function refreshCodexSandbox(): Promise<CodexSandbox> {
  if (process.platform !== "win32") return "ready";
  const hit = sandboxCache.__zeffCodexSandbox;
  if (hit && Date.now() - hit.at < (hit.state === "unknown" ? 60000 : 600000)) return hit.state;
  const cli = findCodexCli();
  if (!cli) return "unknown";
  const state = await new Promise<CodexSandbox>((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ cli.command, [...cli.args, "app-server"], { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let buf = "";
    let done = false;
    const end = (s: CodexSandbox) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child);
      resolve(s);
    };
    const timer = setTimeout(() => end("unknown"), 20000);
    const send = (o: object) => child.stdin.write(`${JSON.stringify(o)}\n`);
    child.stdin.on("error", () => {});
    child.on("error", () => end("unknown"));
    child.on("exit", () => end("unknown"));
    child.stdout.on("data", (d) => {
      buf += d;
      for (let n = buf.indexOf("\n"); n >= 0; n = buf.indexOf("\n")) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        try {
          const j = JSON.parse(line) as { id?: number; result?: { status?: string } };
          if (j.id === 1) send({ id: 2, method: "windowsSandbox/readiness" });
          else if (j.id === 2) end(j.result?.status === "ready" || j.result?.status === "notConfigured" || j.result?.status === "updateRequired" ? j.result.status : "unknown");
        } catch {
          // not JSON: skipped
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "zeff", title: null, version: "0" }, capabilities: null } });
  });
  sandboxCache.__zeffCodexSandbox = { at: Date.now(), state };
  return state;
}

/**
 * The sandbox state for a page: the last answer at once, and — when it is stale or was never asked — a
 * refresh in the background (the CLI takes seconds, up to its 20 s timeout: a page must not wait for it).
 */
export function codexSandboxNow(): CodexSandbox {
  void refreshCodexSandbox().catch(() => {});
  return codexSandboxState();
}

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: unknown; [k: string]: unknown };

/**
 * A JSON schema as OpenAI's structured outputs take it (strict): every object closed
 * (additionalProperties false) and every property required — an optional one may be null instead.
 */
export function strictSchema(s: Schema): Schema {
  if (!s || typeof s !== "object") return s;
  const out: Schema = { ...s };
  if (s.items) out.items = strictSchema(s.items);
  if (s.properties) {
    const required = new Set(s.required ?? []);
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => {
        const strict = strictSchema(v);
        if (required.has(k)) return [k, strict];
        // Optional: may be null (left out again in the answer).
        const types = Array.isArray(strict.type) ? strict.type : strict.type ? [strict.type] : [];
        return [k, types.length ? { ...strict, type: [...new Set([...types, "null"])] } : { anyOf: [strict, { type: "null" }] }];
      }),
    );
    out.required = Object.keys(s.properties);
    out.additionalProperties = false;
  }
  return out;
}

/** An answer to a strict schema, back in the original's shape: an optional property that came as null is left out. */
export function unstrict(value: unknown, s: Schema): unknown {
  if (Array.isArray(value)) return s?.items ? value.map((v) => unstrict(v, s.items!)) : value;
  if (!value || typeof value !== "object" || !s?.properties) return value;
  const required = new Set(s.required ?? []);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => !(v === null && !required.has(k)))
      .map(([k, v]) => [k, s.properties![k] ? unstrict(v, s.properties![k]) : v]),
  );
}

/** What went wrong, in a sentence — "not signed in" when the CLI got a 401. */
const codexError = (message: string) =>
  /401|unauthori[sz]ed|not logged in|missing bearer/i.test(message)
    ? "The Codex CLI isn't signed in — run `codex login` once (with your ChatGPT account)."
    : `The Codex CLI run failed: ${message.trim().slice(0, 600)}`;

/**
 * One headless Codex CLI run (ChatGPT), closed and read-only: a read-only sandbox, none of your
 * Codex config (no MCP servers, no rules), no session kept — the prompt on stdin, the answer as
 * JSON matching `schema`. Signed in as the CLI is (your ChatGPT login). Rejects with what went wrong.
 */
export function runCodex<T>(prompt: string, schema: object, opts: { model?: string; effort?: string; timeoutMs?: number } = {}): Promise<AiAnswer<T>> {
  const cli = findCodexCli();
  if (!cli) return Promise.reject(new Error("The Codex CLI wasn't found — npm install -g @openai/codex, or set CODEX_CLI."));
  // Somewhere without an AGENTS.md of its own; the schema next to it.
  const cwd = path.join(os.tmpdir(), "zeff-codex");
  fs.mkdirSync(/*turbopackIgnore: true*/ cwd, { recursive: true });
  const schemaFile = path.join(cwd, `schema-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(/*turbopackIgnore: true*/ schemaFile, JSON.stringify(strictSchema(schema as Schema)));
  const args = [
    ...cli.args,
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-schema",
    schemaFile,
    "-C",
    cwd,
  ];
  if (opts.model) args.push("-m", opts.model);
  if (opts.effort) args.push("-c", `model_reasoning_effort="${opts.effort}"`);
  args.push("-");
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ cli.command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopListening();
      fs.rmSync(/*turbopackIgnore: true*/ schemaFile, { force: true });
      fn();
    };
    const stopListening = onAbort(() =>
      finish(() => {
        killTree(child);
        reject(new Error(ABORTED));
      }),
    );
    const timer = setTimeout(
      () =>
        finish(() => {
          killTree(child);
          reject(new Error(`The Codex CLI took longer than ${Math.round((opts.timeoutMs ?? 600000) / 60000)} minutes — stopped.`));
        }),
      opts.timeoutMs ?? 600000,
    );
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => finish(() => reject(new Error(`The Codex CLI couldn't start: ${e.message}`))));
    child.on("close", (code) =>
      finish(() => {
        // Its events, one JSON a line: the last agent message is the answer; a failed turn says why.
        const events = stdout
          .split("\n")
          .map((l) => {
            try {
              return JSON.parse(l) as { type?: string; item?: { type?: string; text?: string }; error?: { message?: string }; message?: string; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } };
            } catch {
              return null;
            }
          })
          .filter((e) => e !== null);
        const failed = events.find((e) => e.type === "turn.failed");
        if (failed) return reject(new Error(codexError(failed.error?.message ?? "the turn failed")));
        const text = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").pop()?.item?.text;
        if (!text) {
          const error = events.filter((e) => e.type === "error").pop()?.message;
          return reject(new Error(codexError(error ?? `no answer (exit ${code}): ${(stderr || stdout).trim().slice(-600)}`)));
        }
        let output: T;
        try {
          output = unstrict(jsonIn(text), schema as Schema) as T;
        } catch {
          return reject(new NoJsonError(`The Codex CLI answered with no JSON: ${text.slice(0, 600)}`));
        }
        // The turns' tokens, when the CLI says them (no price: a ChatGPT login has none per token).
        const used = events.filter((e) => e.type === "turn.completed" && e.usage).map((e) => e.usage!);
        const usage = used.length ? { input: used.reduce((n, u) => n + (u.input_tokens ?? 0), 0), output: used.reduce((n, u) => n + (u.output_tokens ?? 0), 0), cacheRead: used.reduce((n, u) => n + (u.cached_input_tokens ?? 0), 0), cacheWrite: 0 } : undefined;
        resolve({ output, model: opts.model || null, costUsd: null, durationMs: Date.now() - started, usage });
      }),
    );
    child.stdin.on("error", () => {}); // a CLI that quits early closes its stdin: its exit says why
    child.stdin.end(prompt, "utf8");
  });
}
