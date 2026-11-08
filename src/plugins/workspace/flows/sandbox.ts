import fs from "node:fs";
import path from "node:path";
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import base from "@jitl/quickjs-wasmfile-release-sync";

/**
 * JavaScript of a flow's script node, in a sandbox: QuickJS compiled to WebAssembly — its own heap, no network, no files, no
 * timers, no access to Zeff; a memory limit and a time limit (an endless loop is interrupted). The script sees `input` (its
 * node's input) and `steps` (the outputs so far) as plain data and returns a value; `log(...)` lines come back with it.
 * Data goes in and out as JSON only. Server only.
 */

let mod: Promise<QuickJSWASMModule> | null = null;
// (The WebAssembly read from node_modules by hand: a bundler (Next) moves the module and its own lookup of the file fails.)
const WASM = path.join(process.cwd(), "node_modules", "@jitl", "quickjs-wasmfile-release-sync", "dist", "emscripten-module.wasm");
const quickjs = () =>
  (mod ??= newQuickJSWASMModuleFromVariant(
    newVariant(base, {
      wasmBinary: async () => {
        const buf = await fs.promises.readFile(WASM);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      },
    }),
  ).catch((e) => {
    mod = null;
    throw e;
  }));

export type ScriptResult = { ok: true; value: unknown; logs: string[]; ms: number } | { ok: false; error: string; logs: string[]; ms: number };

const MAX_OUT = 2_000_000;

/** Runs `code` (a function body: `return …`) with these globals; at most `timeoutMs` and `memoryMb`. */
export async function runScript(code: string, globals: Record<string, unknown>, opts: { timeoutMs?: number; memoryMb?: number } = {}): Promise<ScriptResult> {
  const t0 = Date.now();
  const logs: string[] = [];
  const q = await quickjs();
  const rt = q.newRuntime();
  rt.setMemoryLimit((opts.memoryMb ?? 64) * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  const deadline = t0 + (opts.timeoutMs ?? 3000);
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  try {
    const log = vm.newFunction("log", (...args) => {
      if (logs.length < 200) logs.push(args.map((a) => { const v = vm.dump(a); return typeof v === "string" ? v : JSON.stringify(v); }).join(" ").slice(0, 2000));
    });
    vm.setProp(vm.global, "log", log);
    log.dispose();
    // The data as JSON, parsed inside: nothing of the host is reachable from the script.
    const data = JSON.stringify(globals);
    const wrapped = `"use strict";
const __g = JSON.parse(${JSON.stringify(data)});
for (const k of Object.keys(__g)) globalThis[k] = __g[k];
const console = { log, info: log, warn: log, error: log };
const __out = (function () { ${code}\n })();
__out === undefined ? "null" : JSON.stringify(__out);`;
    const r = vm.evalCode(wrapped, "flow-script.js");
    if (r.error) {
      const e = vm.dump(r.error) as { name?: string; message?: string } | string;
      r.error.dispose();
      const msg = typeof e === "string" ? e : e?.message === "interrupted" ? `took longer than ${opts.timeoutMs ?? 3000} ms (stopped)` : `${e?.name ?? "Error"}: ${e?.message ?? JSON.stringify(e)}`;
      return { ok: false, error: msg, logs, ms: Date.now() - t0 };
    }
    const out = vm.dump(r.value) as string;
    r.value.dispose();
    if (typeof out !== "string") return { ok: true, value: null, logs, ms: Date.now() - t0 };
    if (out.length > MAX_OUT) return { ok: false, error: "its result is too large (more than 2 MB)", logs, ms: Date.now() - t0 };
    return { ok: true, value: JSON.parse(out), logs, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), logs, ms: Date.now() - t0 };
  } finally {
    vm.dispose();
    rt.dispose();
  }
}
