import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiAnswer } from "./claude";

/** How to start the Copilot CLI: a program and the arguments before ours. */
export type CopilotCommand = { command: string; args: string[]; where: string };

/**
 * Where GitHub's Copilot CLI is: COPILOT_CLI (its .js entry, or a program), else the npm
 * package's entry next to a PATH entry (started with node — a .cmd can't be started without a
 * shell, and a shell can't be trusted with a long prompt), else copilot(.exe) on the PATH.
 */
export function findCopilotCli(): CopilotCommand | null {
  const own = process.env.COPILOT_CLI?.trim();
  if (own && fs.existsSync(/*turbopackIgnore: true*/ own)) return /\.(c|m)?js$/.test(own) ? { command: process.execPath, args: [own], where: own } : { command: own, args: [], where: own };
  const exe = process.platform === "win32" ? "copilot.exe" : "copilot";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const pkgDir = path.join(dir, "node_modules", "@github", "copilot");
    try {
      const pkg = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(pkgDir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.copilot;
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

/**
 * The models the Copilot CLI takes — the choices of its `model` setting, as `copilot help config`
 * lists them (asked once an hour; nothing is sent anywhere). Empty when the CLI isn't there or
 * says nothing usable.
 */
export async function copilotModels(): Promise<string[]> {
  const cache = globalThis as { __zeffCopilotModels?: { at: number; list: string[] } };
  const hit = cache.__zeffCopilotModels;
  // A list for an hour; "none" (no CLI, nothing usable) for ten minutes — not asked on every page.
  if (hit && Date.now() - hit.at < (hit.list.length ? 3600000 : 600000)) return hit.list;
  const cli = findCopilotCli();
  if (!cli) return [];
  const out = await new Promise<string>((resolve) =>
    execFile(
      /*turbopackIgnore: true*/ cli.command,
      [...cli.args, "help", "config"],
      { cwd: os.tmpdir(), timeout: 30000, windowsHide: true, maxBuffer: 4_000_000 },
      (err, stdout) => resolve(err ? "" : String(stdout)),
    ),
  );
  const section = /`model`:[^\n]*\n((?:[ \t]+- "[^"]+"\r?\n?)+)/.exec(out)?.[1] ?? "";
  const list = [...new Set([...section.matchAll(/- "([^"]+)"/g)].map((m) => m[1]))];
  cache.__zeffCopilotModels = { at: Date.now(), list };
  return list;
}

/** The first JSON object in a text (an answer wrapped in prose or a ```json fence included). */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  const json = text.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    // A quote the model didn't escape („Ich kann jetzt" — a German quote closed with "), a raw
    // line break in a string: mended, else the first error stands.
    try {
      return JSON.parse(mendJson(json));
    } catch {
      throw e;
    }
  }
}

/**
 * JSON as models get it wrong, mended: inside a string, a " that isn't followed by what may come
 * after a string (, } ] :) is part of the text — escaped; raw line breaks and tabs are escaped too.
 */
export function mendJson(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (c === "\\") {
      out += c + (json[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === '"') {
      const next = json.slice(i + 1).match(/^\s*([\s\S])/)?.[1];
      if (next === undefined || [",", "}", "]", ":"].includes(next)) {
        out += c;
        inString = false;
      } else out += '\\"';
      continue;
    }
    out += c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c;
  }
  return out;
}

/** The longest prompt passed on the command line (Windows allows 32,767 characters in all). */
export const COPILOT_MAX_PROMPT = 28000;

/**
 * One headless Copilot CLI run: the prompt (with the schema to answer in) as -p, only the
 * answer printed (-s), never asking back, no tools allowed (without --allow-all-tools it can't
 * use any) — in an empty folder. Signed in as the CLI is (`copilot` → /login, or GH_TOKEN).
 */
export function runCopilot<T>(prompt: string, schema: object, opts: { model?: string; timeoutMs?: number } = {}): Promise<AiAnswer<T>> {
  const cli = findCopilotCli();
  if (!cli) return Promise.reject(new Error("The Copilot CLI wasn't found — install it (npm install -g @github/copilot), sign in once (copilot → /login), or set COPILOT_CLI."));
  const full = `${prompt}

Antworte ausschließlich mit einem einzigen JSON-Objekt nach diesem JSON-Schema — ohne Markdown, ohne Erklärung davor oder danach:
${JSON.stringify(schema)}`;
  const cwd = path.join(os.tmpdir(), "zeff-ai");
  fs.mkdirSync(/*turbopackIgnore: true*/ cwd, { recursive: true });
  // The prompt on stdin (piped, Copilot runs it and exits): no command-line length limit.
  const args = [...cli.args, "-s", "--no-ask-user"];
  if (opts.model) args.push("--model", opts.model);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ cli.command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          child.kill();
          reject(new Error(`The Copilot CLI took longer than ${Math.round((opts.timeoutMs ?? 600000) / 60000)} minutes — stopped.`));
        }),
      opts.timeoutMs ?? 600000,
    );
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => finish(() => reject(new Error(`The Copilot CLI couldn't start: ${e.message}`))));
    child.stdin.on("error", () => {}); // a CLI that quits early: its exit says why
    child.stdin.end(full, "utf8");
    child.on("close", (code) =>
      finish(() => {
        if (code !== 0) {
          reject(new Error(`The Copilot CLI failed (exit ${code}): ${(stderr || stdout).trim().slice(0, 600)}`));
          return;
        }
        try {
          resolve({ output: jsonIn(stdout) as T, model: opts.model || "Copilot (Standard)", costUsd: null, durationMs: Date.now() - started });
        } catch (e) {
          // The whole answer kept, to see what went wrong.
          const kept = path.join(cwd, `bad-answer-${Date.now()}.txt`);
          try {
            fs.writeFileSync(/*turbopackIgnore: true*/ kept, stdout, "utf8");
          } catch {
            // not kept, then
          }
          reject(new Error(`The Copilot CLI answered without valid JSON (${(e as Error).message}; the answer: ${kept}): ${stdout.trim().slice(0, 300)}`));
        }
      }),
    );
  });
}
