import { spawn } from "node:child_process";
import { ABORTED, killTree, onAbort } from "@/lib/abort";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiAnswer } from "@/lib/ai/shared";

/**
 * Where the Claude CLI is: CLAUDE_CLI, else the native claude(.exe) that the npm shim on the
 * PATH starts (a .cmd can't be started without a shell), else claude(.exe) on the PATH.
 */
export function findClaudeCli(): string | null {
  const own = process.env.CLAUDE_CLI?.trim();
  if (own && fs.existsSync(/*turbopackIgnore: true*/ own)) return own;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const candidate of [path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", exe), path.join(dir, exe)]) {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
    }
  }
  const local = path.join(os.homedir(), ".local", "bin", exe); // the native installer's place
  return fs.existsSync(/*turbopackIgnore: true*/ local) ? local : null;
}


/**
 * One headless Claude CLI run, closed and read-only: no tools, no MCP servers, no settings
 * (so no hooks), no session kept — the prompt on stdin, the answer as JSON matching `schema`.
 * Signed in as the CLI is (your Claude login). Rejects with what went wrong.
 */
export function runClaude<T>(
  prompt: string,
  schema: object,
  opts: { model?: string; systemPrompt?: string; timeoutMs?: number; maxBudgetUsd?: number; readDir?: string; extraPath?: string; plain?: boolean } = {},
): Promise<AiAnswer<T>> {
  const cli = findClaudeCli();
  if (!cli) return Promise.reject(new Error("The Claude CLI wasn't found — install Claude Code, or set CLAUDE_CLI to claude.exe."));
  // Somewhere without a CLAUDE.md or project settings of its own.
  const cwd = path.join(os.tmpdir(), "zeff-boards");
  fs.mkdirSync(/*turbopackIgnore: true*/ cwd, { recursive: true });
  const args = [
    "-p",
    "--output-format",
    "json",
    // `plain`: no schema — the answer is the model's own text (a transcription is too long and too free for a field).
    ...(opts.plain ? [] : ["--json-schema", JSON.stringify(schema)]),
    // Closed: no tools — except, for reading a picture or a PDF, the Read tool on one folder.
    "--tools",
    opts.readDir ? "Read" : "",
    ...(opts.readDir ? ["--add-dir", opts.readDir] : []),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--setting-sources",
    "",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
  if (opts.maxBudgetUsd) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  // Not a session nested in another one (when Zeff itself was started from Claude Code).
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // A folder of programs the CLI's tools may need (Poppler's pdftoppm, installed just now: not on this server's PATH yet).
  if (opts.extraPath) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    env[key] = `${opts.extraPath}${path.delimiter}${env[key] ?? ""}`;
  }

  return new Promise((resolve, reject) => {
    // CLAUDE_CLI may be a script (a stand-in, as in the tests): run with node.
    const script = /\.(c|m)?js$/i.test(cli);
    const child = spawn(/*turbopackIgnore: true*/ script ? process.execPath : cli, script ? [cli, ...args] : args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopListening();
      fn();
    };
    // The sync it's part of stopped: the CLI (and what it started) ended.
    const stopListening = onAbort(() =>
      finish(() => {
        killTree(child);
        reject(new Error(ABORTED));
      }),
    );
    const timer = setTimeout(
      () =>
        finish(() => {
          // The whole tree (its MCP servers, shells): on Windows a plain kill leaves them running.
          killTree(child);
          reject(new Error(`The Claude CLI took longer than ${Math.round((opts.timeoutMs ?? 600000) / 60000)} minutes — stopped.`));
        }),
      opts.timeoutMs ?? 600000,
    );
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => finish(() => reject(new Error(`The Claude CLI couldn't start: ${e.message}`))));
    child.on("close", (code) =>
      finish(() => {
        let j: {
          is_error?: boolean;
          subtype?: string;
          result?: string;
          structured_output?: T;
          total_cost_usd?: number;
          duration_ms?: number;
          modelUsage?: Record<string, unknown>;
        };
        try {
          j = JSON.parse(stdout);
        } catch {
          reject(new Error(`The Claude CLI answered with no JSON (exit ${code}): ${(stderr || stdout).trim().slice(0, 600)}`));
          return;
        }
        if (opts.plain && !j.is_error && typeof j.result === "string" && j.result.trim()) j.structured_output = { text: j.result } as unknown as T;
        if (j.is_error || !j.structured_output) {
          reject(new Error(`The Claude CLI run failed (${j.subtype ?? `exit ${code}`}): ${String(j.result ?? stderr).trim().slice(0, 600)}`));
          return;
        }
        resolve({
          output: j.structured_output,
          // The model that did the work (Claude Code also asks a small one on the side): the one with the most output.
          model:
            Object.entries((j.modelUsage ?? {}) as Record<string, { outputTokens?: number; costUSD?: number }>).sort(
              (a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0) || (b[1]?.costUSD ?? 0) - (a[1]?.costUSD ?? 0),
            )[0]?.[0] ?? null,
          costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
          durationMs: typeof j.duration_ms === "number" ? j.duration_ms : null,
        });
      }),
    );
    child.stdin.on("error", () => {}); // a CLI that quits early closes its stdin: its exit says why
    child.stdin.end(prompt, "utf8");
  });
}
