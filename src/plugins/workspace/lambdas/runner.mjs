// A lambda's process (lambdas/run.ts starts it): Node with its permission model — it reads its own folder only, writes nothing, starts
// no process or worker. Here: the modules that would reach the network or the system around Zeff are refused, `fetch` and
// `context.zeff.call` go to Zeff over the IPC channel (which checks them), console goes into the run's log. It gets one job, runs the
// handler, answers and ends.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// (An empty environment: Windows adds its own variables — the user's name, folders — to any process.)
for (const k of Object.keys(process.env)) if (k !== "NODE_ENV") delete process.env[k];

const BLOCKED = new Set(["net", "tls", "http", "https", "http2", "dgram", "dns", "dns/promises", "child_process", "worker_threads", "cluster", "inspector", "inspector/promises", "repl", "v8", "vm", "wasi", "trace_events"]);
registerHooks({
  resolve(specifier, context, next) {
    const bare = specifier.replace(/^node:/, "");
    if (BLOCKED.has(bare)) throw new Error(`“${specifier}” isn't available in a lambda — use fetch (it goes through Zeff) or context.zeff.call.`);
    return next(specifier, context);
  },
});

let seq = 0;
const waiting = new Map();
const ask = (msg) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    process.send({ ...msg, id });
  });
process.on("message", (m) => {
  if (m?.type === "job") return void run(m);
  const w = waiting.get(m?.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.error) w.reject(new Error(m.error));
  else w.resolve(m.value);
});

const logs = [];
const say = (...args) => {
  if (logs.length >= 300) return;
  logs.push(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ").slice(0, 4000));
};
console.log = console.info = console.warn = console.error = console.debug = say;

/** fetch, through Zeff: the answer comes back whole (5 MB at most) and is made a Response here. */
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers = Object.fromEntries(new Headers(init.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined)).entries());
  const body = init.body === undefined || init.body === null ? undefined : typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : JSON.stringify(init.body);
  const r = await ask({ type: "fetch", url, method: init.method ?? "GET", headers, body });
  return new Response(r.status === 204 || r.status === 304 ? null : Buffer.from(r.body, "base64"), { status: r.status, statusText: r.statusText, headers: r.headers });
};

async function run(job) {
  const started = Date.now();
  try {
    const entry = pathToFileURL(path.join(job.dir, "index.mjs")).href;
    const mod = await import(entry);
    const handler = mod.handler ?? mod.default;
    if (typeof handler !== "function") throw new Error("index.mjs exports no handler (export async function handler(event, context) { … }).");
    const context = {
      name: job.name,
      /** The user's language ("de", "en" …): what the lambda says, it says in it. */
      language: job.language ?? "en",
      secrets: Object.freeze({ ...job.secrets }),
      log: say,
      deadline: started + job.timeoutMs,
      remainingMs: () => Math.max(0, started + job.timeoutMs - Date.now()),
      zeff: { call: (name, input = {}) => ask({ type: "call", name, input }) },
    };
    const result = await handler(job.event, context);
    process.send({ type: "done", ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)), logs, ms: Date.now() - started }, () => process.exit(0));
  } catch (e) {
    process.send({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? String(e.stack ?? "").split("\n").slice(0, 8).join("\n") : "", logs, ms: Date.now() - started }, () => process.exit(0));
  }
}
