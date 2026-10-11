import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { currentAccountId } from "@/db/accounts";
import { tokenFor } from "./token";
import { enabledPlugins, type ExtPlugin } from "./registry";
import type { ExtEvent } from "./manifest";

/**
 * Event hooks: when something happens in Zeff (a Work run starts or ends …) the programs plugins
 * declared for that event are started — once per event, without a shell, in the plugin's folder,
 * the event as JSON on stdin, a time limit (killed with what it started), at most four at a time per
 * plugin. Fire and forget: a hook never delays Zeff, and a failing one only shows in the log on
 * the Plugins page.
 */

export type HookRun = { at: string; plugin: string; event: string; ok: boolean; ms: number; exit: number | null; output: string };

const state = globalThis as { __zeffExtHookLog?: HookRun[]; __zeffExtHookBusy?: Map<string, number> };
const log = (state.__zeffExtHookLog ??= []);
const busy = (state.__zeffExtHookBusy ??= new Map());
const MAX_LOG = 100;
const MAX_PARALLEL = 4;
const MAX_OUTPUT = 4000;

/** Where plugins reach Zeff's API from outside the browser. */
export const apiBase = (): string => (process.env.ZEFF_URL || `http://127.0.0.1:${process.env.PORT || 9333}`).replace(/\/$/, "");

/**
 * A manifest's program → what to run: "node" is the Node running Zeff (always there, even in the
 * packaged app), "./x" and ".\x" are in the plugin's folder (also as arguments), the rest as written.
 */
export function resolveCommand(dir: string, argv: string[]): { command: string; args: string[] } {
  const inDir = (s: string) => (/^\.[\\/]/.test(s) ? path.join(/*turbopackIgnore: true*/ dir, s.slice(2)) : s);
  const [first, ...rest] = argv;
  return { command: first === "node" ? process.execPath : inDir(first), args: rest.map(inDir) };
}

/** The environment of a program a plugin starts: Zeff's, without its own secrets and Next's variables — plus how to reach the API. */
export function extEnv(p: ExtPlugin, extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ZEFF_WORK_TOKEN|ZEFF_MCP_TOKEN|ZEFF_EXT_|NODE_ENV|NODE_OPTIONS|DATABASE_PATH|PORT|HOSTNAME|ELECTRON_RUN_AS_NODE)$/i.test(k)) continue;
    if (/^(NEXT_|__NEXT|npm_|TURBOPACK)/i.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ZEFF_API_URL: apiBase(), ZEFF_EXT_ID: p.id, ZEFF_EXT_TOKEN: tokenFor(p.id), ZEFF_ACCOUNT: currentAccountId(), ZEFF_PLUGIN_DIR: p.dir, ...extra };
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  else
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone already
    }
}

const record = (r: HookRun) => {
  log.unshift(r);
  log.length = Math.min(log.length, MAX_LOG);
  if (!r.ok) console.error(`[ext:${r.plugin}] hook ${r.event} failed (${r.exit ?? "timeout"}): ${r.output.slice(0, 300)}`);
};

/** What the plugins' hooks did lately (newest first) — for one plugin, or all. */
export const hookLog = (plugin?: string): HookRun[] => (plugin ? log.filter((r) => r.plugin === plugin) : [...log]);

function runHook(p: ExtPlugin, event: ExtEvent, data: unknown): void {
  const hook = p.manifest.contributes.hooks[event];
  if (!hook || !p.permissions.has("exec")) return;
  if ((busy.get(p.id) ?? 0) >= MAX_PARALLEL) {
    record({ at: new Date().toISOString(), plugin: p.id, event, ok: false, ms: 0, exit: null, output: `skipped: ${MAX_PARALLEL} hooks of this plugin are still running` });
    return;
  }
  const { command, args } = resolveCommand(p.dir, hook.command);
  const started = Date.now();
  let output = "";
  let done = false;
  const finish = (ok: boolean, exit: number | null, note = "") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    busy.set(p.id, Math.max(0, (busy.get(p.id) ?? 1) - 1));
    record({ at: new Date().toISOString(), plugin: p.id, event, ok, ms: Date.now() - started, exit, output: `${note}${output}`.trim().slice(-MAX_OUTPUT) });
  };
  busy.set(p.id, (busy.get(p.id) ?? 0) + 1);
  let timer: ReturnType<typeof setTimeout>;
  try {
    const child = spawn(command, args, { cwd: p.dir, env: extEnv(p, { ZEFF_EVENT: event }) as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    timer = setTimeout(() => {
      killTree(child.pid);
      finish(false, null, `timed out after ${hook.timeoutMs} ms\n`);
    }, hook.timeoutMs);
    const take = (d: Buffer) => {
      output = (output + d.toString("utf8")).slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ event, plugin: p.id, account: currentAccountId(), at: new Date().toISOString(), data })}\n`);
    child.on("error", (e) => finish(false, null, `couldn't start: ${e.message}\n`));
    child.on("close", (code) => finish(code === 0, code));
  } catch (e) {
    timer = setTimeout(() => {}, 0);
    finish(false, null, `couldn't start: ${(e as Error).message}\n`);
  }
}

/**
 * Tell the plugins something happened. Never throws, never waits: the hooks run on their own.
 * `data` is JSON-able (what the event docs list).
 */
export function emitExtEvent(event: ExtEvent, data: unknown = {}): void {
  try {
    for (const p of enabledPlugins()) if (p.manifest.contributes.hooks[event]) runHook(p, event, data);
  } catch (e) {
    console.error("[ext] emitting", event, "failed:", e);
  }
}
