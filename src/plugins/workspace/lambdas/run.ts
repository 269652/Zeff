import { fork, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/db";
import { checkedUrl, flowAction } from "../flows/actions";
import type { FlowPermissions } from "../flows/types";
import { getLookupConfig } from "@/plugins/lookups/config";
import { secretValues } from "../flows/store";
import { getLambda } from "./store";
import type { Lambda, LambdaManifest } from "./types";
import { checkFields, checkHits, checkSchema, type FieldValue, type LookupHitOut } from "./validate";

/**
 * A lambda run: its files written to a folder of their own (one per version, so a run never sees half a save), its npm dependencies
 * installed there (without their install scripts), a Node process started on it with the permission model — reading that folder only,
 * no writing, no processes, a memory limit, a time limit, an empty environment. Its fetch and context.zeff.call come here: checked
 * against its manifest (the domains, never a private address; the Zeff functions it names, only those that change nothing). Its answer
 * is checked against its kind; secrets never show in an error or log. At most four run at once. Server only.
 */

export type LambdaRun = { ok: true; result: unknown; logs: string[]; ms: number } | { ok: false; error: string; problems?: string[]; stack?: string; logs: string[]; ms: number };

// (turbopackIgnore: a file run at runtime, not a module of the build — the production build fails to resolve it otherwise.)
const RUNNER = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "plugins", "workspace", "lambdas", "runner.mjs");
const MAX_BODY = 5_000_000;
const PARALLEL = 4;
let running = 0;
const queue: (() => void)[] = [];
const slot = async () => {
  if (running >= PARALLEL) await new Promise<void>((res) => queue.push(res));
  running++;
  return () => {
    running--;
    queue.shift()?.();
  };
};

/** The secrets a lambda may read: your Studio secrets, and the Lookups settings' keys as TMDB_KEY / GOOGLE_KEY — only those it names. */
export function secretsFor(m: Pick<LambdaManifest, "secrets">): Record<string, string> {
  const all: Record<string, string> = { ...secretValues() };
  const c = getLookupConfig();
  if (c.tmdbKey && !all.TMDB_KEY) all.TMDB_KEY = c.tmdbKey;
  if (c.googleKey && !all.GOOGLE_KEY) all.GOOGLE_KEY = c.googleKey;
  return Object.fromEntries((m.secrets ?? []).filter((k) => all[k]).map((k) => [k, all[k]]));
}

const hide = (s: string, secrets: Record<string, string>) => Object.values(secrets).filter((v) => v.length >= 4).reduce((acc, v) => acc.split(v).join("•••"), s);
const safeName = (n: string) => n.replace(/[^a-z0-9._-]/g, "_");

/** The npm executable (npm.cmd on Windows), or null where there is none. */
const npmBin = () => (process.platform === "win32" ? "npm.cmd" : "npm");

/** Its dependencies installed into its folder (once per set of them): what npm said. */
export async function installDeps(dir: string, deps: Record<string, string>): Promise<{ ok: boolean; log: string }> {
  const marker = path.join(dir, ".installed");
  if (!Object.keys(deps).length || fs.existsSync(marker)) return { ok: true, log: "" };
  return new Promise((resolve) => {
    let log = "";
    const p = spawn(npmBin(), ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--no-package-lock", "--loglevel=error"], { cwd: dir, shell: process.platform === "win32", env: { ...process.env, npm_config_update_notifier: "false" } });
    p.stdout.on("data", (d) => (log += String(d)));
    p.stderr.on("data", (d) => (log += String(d)));
    const timer = setTimeout(() => p.kill(), 180000);
    p.on("error", (e) => (clearTimeout(timer), resolve({ ok: false, log: `npm isn't on this computer (${e.message}) — a lambda with dependencies needs Node.js with npm installed.` })));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) fs.writeFileSync(marker, new Date().toISOString());
      resolve({ ok: code === 0, log: log.slice(-8000) || (code === 0 ? "installed" : `npm ended with ${code}`) });
    });
  });
}

/** Its folder for this version: the files, a package.json, the dependencies. */
export async function materialize(l: Lambda): Promise<{ dir: string; install: { ok: boolean; log: string } }> {
  const deps = l.manifest.dependencies ?? {};
  const hash = crypto.createHash("sha1").update(JSON.stringify([l.files, deps])).digest("hex").slice(0, 16);
  const base = path.join(dataDir(), "lambdas", safeName(l.manifest.name));
  const dir = path.join(base, hash);
  if (!fs.existsSync(path.join(dir, "index.mjs"))) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, code] of Object.entries(l.files)) fs.writeFileSync(path.join(dir, f), code);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: safeName(l.manifest.name).replace(/\./g, "-"), private: true, type: "module", dependencies: deps }, null, 2));
    // (The older versions go, the three newest stay.)
    try {
      const old = fs.readdirSync(base).map((d) => ({ d, t: fs.statSync(path.join(base, d)).mtimeMs })).sort((a, b) => b.t - a.t).slice(3);
      for (const o of old) fs.rmSync(path.join(base, o.d), { recursive: true, force: true });
    } catch {
      // (In use: next time.)
    }
  }
  return { dir, install: await installDeps(dir, deps) };
}

/** A fetch of the lambda's, done here: the address checked (each redirect too), 5 MB at most, the answer whole. */
async function proxyFetch(m: LambdaManifest, req: { url: string; method?: string; headers?: Record<string, string>; body?: string }, resolve?: (host: string) => Promise<string[]>) {
  const perms: FlowPermissions = { web: m.web ?? [] };
  let url = await checkedUrl(req.url, perms, resolve);
  const method = (req.method ?? "GET").toUpperCase();
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { method, headers: { "user-agent": "Zeff/0.1 (personal app; https://getzeff.com)", ...(req.headers ?? {}) }, body: method === "GET" || method === "HEAD" ? undefined : req.body, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = await checkedUrl(new URL(r.headers.get("location")!, url).toString(), perms, resolve);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BODY) throw new Error(`${url.hostname}: the answer is larger than 5 MB.`);
    return { status: r.status, statusText: r.statusText, headers: Object.fromEntries([...r.headers].filter(([k]) => !/^set-cookie$/i.test(k))), body: buf.toString("base64") };
  }
  throw new Error("Too many redirects.");
}

/** A Zeff function the lambda named: one that changes nothing, with the lambda's web. */
async function proxyCall(m: LambdaManifest, name: string, input: unknown) {
  if (!(m.zeff ?? []).includes(name)) throw new Error(`This lambda may not call “${name}” — name it in lambda.json's "zeff".`);
  const a = flowAction(name);
  if (!a) throw new Error(`There is no Zeff function “${name}”.`);
  if (a.writes) throw new Error(`“${name}” changes something — a lambda only reads; a flow can write what it returns.`);
  const perms: FlowPermissions = { web: m.web ?? [], ai: true };
  return a.run((input && typeof input === "object" ? input : {}) as Record<string, unknown>, {
    flow: `lambda:${m.name}`,
    runId: null,
    dryRun: false,
    perms,
    web: (u) => checkedUrl(u, perms),
    canWrite: () => {
      throw new Error("A lambda doesn't write.");
    },
    may: () => undefined,
    log: () => undefined,
  });
}

/** A lambda run with this event: what it returned (unchecked — see invokeLookup / invokeFunction), its log, how long it took. */
export async function runLambda(l: Lambda, event: unknown, opts: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<LambdaRun> {
  const t0 = Date.now();
  const secrets = secretsFor(l.manifest);
  const { dir, install } = await materialize(l);
  if (!install.ok) return { ok: false, error: `Its dependencies couldn't be installed: ${install.log}`, logs: [], ms: Date.now() - t0 };
  const release = await slot();
  try {
    return await new Promise<LambdaRun>((resolve) => {
      const runner = RUNNER();
      const child = fork(/*turbopackIgnore: true*/ runner, [], {
        execPath: process.execPath,
        execArgv: ["--permission", `--allow-fs-read=${dir}${path.sep}`, `--allow-fs-read=${runner}`, `--max-old-space-size=${l.manifest.memoryMb ?? 128}`, "--disallow-code-generation-from-strings"],
        cwd: dir,
        env: { ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}), NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr = (stderr + String(d)).slice(-4000)));
      let done = false;
      const finish = (r: LambdaRun) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (child.exitCode === null) child.kill();
        resolve(r.ok ? r : { ...r, error: hide(r.error, secrets), logs: r.logs.map((x) => hide(x, secrets)), ...(r.stack ? { stack: hide(r.stack, secrets) } : {}) });
      };
      const timer = setTimeout(() => finish({ ok: false, error: `took longer than ${(l.manifest.timeoutMs ?? 20000) / 1000} s (stopped)`, logs: [], ms: Date.now() - t0 }), l.manifest.timeoutMs ?? 20000);
      child.on("message", (msg: { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string; stack?: string; logs?: string[]; ms?: number; url?: string; method?: string; headers?: Record<string, string>; body?: string; name?: string; input?: unknown }) => {
        if (msg.type === "done") return finish(msg.ok ? { ok: true, result: msg.result, logs: (msg.logs ?? []).map((x) => hide(x, secrets)), ms: Date.now() - t0 } : { ok: false, error: msg.error ?? "failed", stack: msg.stack, logs: msg.logs ?? [], ms: Date.now() - t0 });
        const answer = (p: Promise<unknown>) =>
          p.then(
            (value) => !done && child.connected && child.send({ id: msg.id, value }),
            (e: unknown) => !done && child.connected && child.send({ id: msg.id, error: hide(e instanceof Error ? e.message : String(e), secrets) }),
          );
        if (msg.type === "fetch") void answer(proxyFetch(l.manifest, { url: String(msg.url), method: msg.method, headers: msg.headers, body: msg.body }, opts.resolve));
        else if (msg.type === "call") void answer(Promise.resolve().then(() => proxyCall(l.manifest, String(msg.name), msg.input)));
      });
      child.on("exit", (code) => finish({ ok: false, error: `the process ended (${code ?? "killed"})${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`, logs: [], ms: Date.now() - t0 }));
      child.on("error", (e) => finish({ ok: false, error: e.message, logs: [], ms: Date.now() - t0 }));
      child.send({ type: "job", dir, name: l.manifest.name, event, secrets, timeoutMs: l.manifest.timeoutMs ?? 20000 });
    });
  } finally {
    release();
  }
}

/** A lookup lambda's search: its hits, checked. */
export async function lookupSearch(name: string, query: string, language: string, opts: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<LookupHitOut[]> {
  const l = getLambda(name);
  if (!l || l.manifest.kind !== "lookup") throw new Error(`There is no lookup lambda “${name}”.`);
  const r = await runLambda(l, { mode: "search", query, language }, opts);
  if (!r.ok) throw new Error(r.error);
  const c = checkHits(r.result);
  if (!c.ok) throw new Error(`${name} returned what a search can't: ${c.problems.slice(0, 3).join("; ")}`);
  return c.value;
}

/** A lookup lambda's details: one hit's fields, checked against its manifest. */
export async function lookupDetails(name: string, id: string, language: string, opts: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<Record<string, FieldValue>> {
  const l = getLambda(name);
  if (!l || l.manifest.kind !== "lookup") throw new Error(`There is no lookup lambda “${name}”.`);
  const r = await runLambda(l, { mode: "details", id, language }, opts);
  if (!r.ok) throw new Error(r.error);
  const c = checkFields(r.result, l.manifest);
  if (!c.ok) throw new Error(`${name} returned what its manifest doesn't say: ${c.problems.slice(0, 3).join("; ")}`);
  return c.value;
}

/** Any lambda run, its output checked (a lookup's by its mode, a function's against its schema). */
export async function invokeLambda(name: string, event: unknown, opts: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<LambdaRun & { problems?: string[] }> {
  const l = getLambda(name);
  if (!l) throw new Error(`There is no lambda “${name}”.`);
  const r = await runLambda(l, event, opts);
  if (!r.ok) return r;
  const mode = (event as { mode?: string } | null)?.mode;
  const problems = l.manifest.kind === "lookup" ? (mode === "search" ? checkHits(r.result) : checkFields(r.result, l.manifest)) : l.manifest.output ? { ok: false as const, problems: checkSchema(r.result, l.manifest.output) } : { ok: true as const };
  const list = "problems" in problems ? problems.problems : [];
  return list.length ? { ok: false, error: `Its output doesn't fit: ${list.slice(0, 3).join("; ")}`, problems: list, logs: r.logs, ms: r.ms } : r;
}
