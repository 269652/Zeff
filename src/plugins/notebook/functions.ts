import fs from "node:fs";
import path from "node:path";
import { getPlugin, scanPlugins } from "@/lib/ext/registry";
import { interruptSession, readExecution, startExecution } from "./sessions";
import { notebookEnabled } from "./runtimes";

/**
 * The server functions of external plugins (a manifest's `contributes.functions`): code of the plugin — Python or Node.js — that runs
 * where Notebook cells run (a Docker container, by default), takes its arguments as `inputs` and gives back what it returns. Called
 * over HTTP (POST /api/ext/fn/<plugin>/<name>), from Notebook cells (`zeff.call`), by other functions. A function reads or changes Zeff
 * only through what it was granted (Settings → Notebook → Functions): there is nobody to ask when it runs. Server only.
 */

export type FnInfo = { plugin: string; name: string; title: string; description: string; runtime: "python" | "node"; input: Record<string, string>; needs: string[]; timeoutSeconds: number; webhook: boolean; file: string; dir: string };

/** The functions of the plugins that are on in this account. */
export function listFunctions(): FnInfo[] {
  const out: FnInfo[] = [];
  for (const f of scanPlugins().plugins) {
    if (!f.manifest.contributes.functions.length || !getPlugin(f.id)?.enabled) continue;
    for (const fn of f.manifest.contributes.functions) out.push({ plugin: f.id, name: fn.name, title: fn.title, description: fn.description, runtime: fn.runtime, input: fn.input, needs: fn.needs, timeoutSeconds: fn.timeoutSeconds, webhook: fn.webhook, file: fn.file, dir: f.dir });
  }
  return out;
}

/** The functions of every plugin, on or not (for the settings page: grant before turning on is fine). */
export function declaredFunctions(): FnInfo[] {
  return scanPlugins().plugins.flatMap((f) => f.manifest.contributes.functions.map((fn): FnInfo => ({ plugin: f.id, name: fn.name, title: fn.title, description: fn.description, runtime: fn.runtime, input: fn.input, needs: fn.needs, timeoutSeconds: fn.timeoutSeconds, webhook: fn.webhook, file: fn.file, dir: f.dir })));
}

export type FnResult = { ok: true; value: unknown; log: string } | { ok: false; error: string; log: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_DEPTH = 4;
let depth = 0;

/** A function called: its code run with `args`; the result is what it returned. */
/** The settings a plugin declares, as its functions get them (null: it declares none). */
async function ownSettings(plugin: string): Promise<Record<string, unknown> | null> {
  const p = getPlugin(plugin);
  if (!p?.manifest.contributes.settings?.length) return null;
  return (await import("@/lib/ext/plugin-settings")).pluginSettings(plugin, p.manifest);
}

export async function callFunction(plugin: string, name: string, args: Record<string, unknown> = {}): Promise<FnResult> {
  const f = listFunctions().find((x) => x.plugin === plugin && x.name === name);
  if (!f) return { ok: false, error: `There is no function “${plugin}.${name}” (the plugin must be on and bring it).`, log: "" };
  if (!notebookEnabled()) return { ok: false, error: "Functions run in the Notebook's sessions, and running code is switched off — turn it on in Settings → Notebook.", log: "" };
  if (depth >= MAX_DEPTH) return { ok: false, error: `Functions calling functions: at most ${MAX_DEPTH} deep.`, log: "" };
  let code: string;
  try {
    const file = path.resolve(f.dir, f.file);
    if (!file.startsWith(path.resolve(f.dir) + path.sep)) throw new Error("outside the plugin folder");
    code = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, error: `The function's file could not be read: ${e instanceof Error ? e.message : String(e)}`, log: "" };
  }
  // (A function that calls another of its plugin waits for it: that one runs in a session of its own, one per level - in the same session it would wait for itself.)
  const session = depth === 0 ? `fn-${plugin}` : `fn-${plugin}.${depth}`;
  depth++;
  try {
    // The plugin's own settings (lib/ext/plugin-settings.ts), secrets in clear — only to its own functions, never kept with the run.
    const settings = await ownSettings(plugin);
    const ex = startExecution({ session, language: f.runtime, code, args: settings ? { ...args, zeffSettings: settings } : args });
    const t0 = Date.now();
    for (;;) {
      const r = readExecution(ex.id);
      if (r.status && r.status !== "queued" && r.status !== "running") {
        const outputs = (r.outputs ?? readExecution(ex.id, -1).outputs ?? []) as { output_type: string; name?: string; text?: string; ename?: string; evalue?: string }[];
        const log = outputs.filter((o) => o.output_type === "stream").map((o) => o.text ?? "").join("").slice(-4000);
        if (r.status === "ok") return { ok: true, value: r.returned === undefined ? null : r.returned, log };
        const err = outputs.find((o) => o.output_type === "error");
        return { ok: false, error: err ? `${err.ename}: ${err.evalue}` : `The function ended: ${r.status}.`, log };
      }
      if (Date.now() - t0 > f.timeoutSeconds * 1000) {
        interruptSession(session, f.runtime);
        return { ok: false, error: `The function took longer than ${f.timeoutSeconds} seconds.`, log: "" };
      }
      await sleep(25);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), log: "" };
  } finally {
    depth--;
  }
}
