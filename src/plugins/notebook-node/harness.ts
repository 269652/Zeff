/**
 * The program a Node.js session runs: a small REPL. Each reads one JSON request per line from stdin and
 * answers with lines on stdout that start with a marker only this session knows (ZNB_MARK), so whatever the code itself prints
 * (even from a child process) is never taken for a message. Messages: {id, t:"stream"|"display"|"result"|"error"|"done"|"vars"|"complete"}.
 * Requests: {op:"execute"|"interrupt"|"vars"|"complete"|"shutdown", id, code, pos}. Written to the kernel's folder at start.
 */

export const NODE_HARNESS = String.raw`
"use strict";
const vm = require("node:vm");
const readline = require("node:readline");
const util = require("node:util");
const { createRequire } = require("node:module");

const MARK = process.env.ZNB_MARK;
const realWrite = process.stdout.write.bind(process.stdout);
const send = (m) => realWrite(MARK + JSON.stringify(m) + "\n");
let CUR = null;

const stream = (name) => (...a) => send({ id: CUR, t: "stream", name, text: util.format(...a) + "\n" });
const sandboxConsole = {
  log: stream("stdout"), info: stream("stdout"), debug: stream("stdout"),
  error: stream("stderr"), warn: stream("stderr"),
  table: (d) => send({ id: CUR, t: "stream", name: "stdout", text: util.inspect(d, { depth: 3 }) + "\n" }),
  dir: (d) => send({ id: CUR, t: "stream", name: "stdout", text: util.inspect(d, { depth: 3 }) + "\n" }),
};

const bundle = (v) => {
  if (v && typeof v === "object" && v.__znb) return v.__znb;
  const data = { "text/plain": typeof v === "string" ? util.inspect(v) : util.inspect(v, { depth: 4, maxArrayLength: 100, breakLength: 100 }) };
  if (v && typeof v === "object" && !(v instanceof Error)) {
    try { const j = JSON.stringify(v); if (j !== undefined && j.length < 200000) data["application/json"] = JSON.parse(j); } catch {}
  }
  return data;
};
const display = (...vs) => { for (const v of vs) send({ id: CUR, t: "display", data: bundle(v) }); };
display.html = (s) => ({ __znb: { "text/html": String(s), "text/plain": "<html>" } });
display.markdown = (s) => ({ __znb: { "text/markdown": String(s), "text/plain": String(s) } });
display.svg = (s) => ({ __znb: { "image/svg+xml": String(s), "text/plain": "<svg>" } });
display.png = (b) => ({ __znb: { "image/png": Buffer.from(b).toString("base64"), "text/plain": "<image>" } });

// What the code may read of Zeff: asked over the same pipe the output goes through; the answer comes back as a "reply" line.
const waiting = new Map();
let rseq = 0;
const call = (op, args) => new Promise((resolve, reject) => {
  const rid = "r" + (++rseq);
  waiting.set(rid, { resolve, reject });
  send({ id: CUR, t: "zeff", rid, op, args: args || {} });
});
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
class Table {
  constructor(cols, rows, title, ids) { this.cols = cols; this.rows = rows; this.title = title; this.ids = ids || null; }
  get length() { return this.rows.length; }
  records() { return this.rows.map((r) => Object.fromEntries(this.cols.map((c, i) => [c, r[i]]))); }
  column(name) { const i = this.cols.indexOf(name); return this.rows.map((r) => r[i]); }
  get __znb() {
    const head = this.cols.map((c) => "<th>" + esc(c) + "</th>").join("");
    const body = this.rows.slice(0, 200).map((r) => "<tr>" + r.map((v) => "<td>" + esc(v === null || v === undefined ? "" : v) + "</td>").join("") + "</tr>").join("");
    return { "text/html": "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>", "text/plain": this.cols.join(" | ") + "\n" + this.rows.slice(0, 30).map((r) => r.join(" | ")).join("\n") };
  }
}
const zeff = {
  tables: () => call("tables"),
  table: async (name) => { const r = await call("table", { name }); return new Table(r.cols, r.rows, name); },
  metrics: async () => Object.fromEntries((await call("metrics")).map((m) => [m.label, m.value])),
  metric: async (name) => (await call("metric", { name })).value,
  outputs: async () => Object.fromEntries((await call("outputs")).map((o) => [o.name, o.value])),
  output: async (name) => (await call("output", { name })).value,
  api: (method, params) => call("api", { method: String(method), params: jsonable(params || {}) }),
  ai: (prompt, json, opts) => call("ai", { prompt: String(prompt), json: !!json, ...(opts && opts.schema ? { schema: jsonable(opts.schema) } : {}), ...(opts && opts.minutes ? { minutes: Number(opts.minutes) } : {}) }),
  call: (plugin, name, args) => call("call", { plugin, name, fargs: jsonable(args || {}) }),
  databases: () => call("databases"),
  database: async (nameOrId) => { const r = await call("database", { name: nameOrId }); return new Table(r.cols, r.rows, r.title, r.ids); },
  // Writing into Zeff: each needs its own permission, asked when the code first does it.
  publish: (name, value, unit) => call("publish", { name, value: jsonable(value), unit }),
  addRow: (database, fields) => call("add_row", { database, fields: jsonable(fields) }),
  updateRow: (database, id, fields) => call("update_row", { database, id, fields: jsonable(fields) }),
  deleteRow: (database, id) => call("delete_row", { database, id }),
};
// Zeff's own structure, from code - each kind with a permission of its own (asked when the code first needs it).
const meta = (op, args) => call("meta", { mop: op, margs: jsonable(args) });
zeff.meta = {
  pageCreate: async (title, opts = {}) => (await meta("page.create", { title, ...opts })).id,
  pageUpdate: (page, opts) => meta("page.update", { id: page, ...opts }),
  pageArchive: (page) => meta("page.archive", { id: page }),
  databaseCreate: async (title, opts = {}) => (await meta("database.create", { title, ...opts })).id,
  databaseAlter: (database, ops) => meta("database.alter", { database, ops }),
  blockSave: async (block) => (await meta("block.save", { block })).name,
  flowSave: (flow, opts = {}) => meta("flow.save", { flow, ...opts }),
  pluginSave: (id, manifest, files = {}) => meta("plugin.save", { id, manifest, files }),
  // reading how Zeff is built (not the rows)
  tree: () => meta("tree", {}),
  schema: (database) => meta("schema", { database }),
  blocks: () => meta("blocks.list", {}),
  flows: () => meta("flows.list", {}),
  plugins: () => meta("plugins.list", {}),
  // deleting for good: its own permission
  pageDelete: (page) => meta("page.delete", { id: page }),
  blockDelete: (name) => meta("block.delete", { name }),
  flowDelete: (page) => meta("flow.delete", { page }),
  pluginDelete: (id) => meta("plugin.delete", { id }),
};

// Strings shared by the kernels of this page (Python, Node.js, Rust) - like localStorage: serialize what you put in
// (JSON.stringify(x)) and parse what you take out (JSON.parse(s)). Kept with the page, also after a restart.
const SHARED = new Map();
const sharedStorage = {
  get: (key) => (SHARED.has(String(key)) ? SHARED.get(String(key)) : null),
  set: (key, value) => {
    if (typeof value !== "string") throw new TypeError("sharedStorage holds strings: serialize the value first, e.g. sharedStorage.set(key, JSON.stringify(value))");
    SHARED.set(String(key), value);
    send({ id: CUR, t: "storage", op: "set", key: String(key), value });
  },
  remove: (key) => { if (SHARED.delete(String(key))) send({ id: CUR, t: "storage", op: "remove", key: String(key) }); },
  keys: () => [...SHARED.keys()],
  clear: () => { SHARED.clear(); send({ id: CUR, t: "storage", op: "clear" }); },
  get length() { return SHARED.size; },
};
sharedStorage.getItem = sharedStorage.get;
sharedStorage.setItem = sharedStorage.set;
sharedStorage.removeItem = sharedStorage.remove;

const ctx = vm.createContext({
  console: sandboxConsole, display, require: createRequire(process.cwd() + "/cell.js"), process, Buffer,
  setTimeout, setInterval, clearTimeout, clearInterval, setImmediate, queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder,
  fetch, AbortController, structuredClone, performance, zeff, Table, sharedStorage,
});
ctx.globalThis = ctx;

const KEYWORD = /^(const|let|var|if|for|while|do|function|class|return|throw|try|switch|import|export|async\s+function|break|continue|\}|\{|\/\/|\/\*)/;
/** A cell that awaits at its top level: made the body of an async function; "const x =" becomes a global, the last expression is returned. */
function wrapAsync(code) {
  const lines = code.split("\n").map((l) => l.replace(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/, "$2 ="));
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i >= 0) {
    const s = lines[i].trim();
    if (!KEYWORD.test(s) && !s.endsWith("{") && !s.endsWith("}")) lines[i] = "return (" + s.replace(/;+$/, "") + ");";
  }
  return "(async () => {\n" + lines.join("\n") + "\n})()";
}

/** A cell's top-level const / let made var: they are then variables of the session (listed, and a cell may be run again without "already declared"). */
function topLevelVar(code) {
  let out = "", depth = 0, i = 0, atStart = true;
  const n = code.length;
  const quote = [String.fromCharCode(34), String.fromCharCode(39), String.fromCharCode(96)];
  while (i < n) {
    const c = code[i];
    if (atStart && depth === 0) {
      const m = /^(const|let)(\s+)/.exec(code.slice(i, i + 12));
      if (m) { out += "var" + m[2]; i += m[0].length; atStart = false; continue; }
    }
    atStart = false;
    if (c === "\n") { atStart = true; out += c; i++; continue; }
    if (c === "/" && code[i + 1] === "/") { while (i < n && code[i] !== "\n") out += code[i++]; continue; }
    if (c === "/" && code[i + 1] === "*") { const e = code.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; out += code.slice(i, end); i = end; continue; }
    if (quote.includes(c)) { let j = i + 1; while (j < n && code[j] !== c) { if (code[j] === "\\") j++; j++; } out += code.slice(i, j + 1); i = j + 1; continue; }
    if ("{([".includes(c)) depth++; else if ("})]".includes(c)) depth = Math.max(0, depth - 1);
    out += c; i++;
  }
  return out;
}

const jsonable = (v) => {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? String(x) : x instanceof Table ? { cols: x.cols, rows: x.rows } : x)));
  } catch { return util.inspect(v); }
};
const identOf = (name) => {
  const id = String(name).replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
  return id && !/^\d/.test(id) && /^[A-Za-z_$][\w$]*$/.test(id) ? id : "";
};
/** What the cell reads: inputs["Name"] (a table as Table, else the value), and a variable of that name when it is one. */
function bindInputs(inputs) {
  const all = {};
  for (const [name, payload] of Object.entries(inputs || {})) {
    const v = payload && typeof payload === "object" && Array.isArray(payload.cols) && Array.isArray(payload.rows) ? new Table(payload.cols, payload.rows, name, payload.ids) : payload;
    all[name] = v;
    const id = identOf(name);
    if (id && !["zeff", "Table", "display", "console", "require", "process", "inputs", "sharedStorage"].includes(id)) ctx[id] = v;
  }
  ctx.inputs = all;
}

async function runCell(id, code, inputs, shared) {
  CUR = id;
  SHARED.clear();
  for (const [k, v] of Object.entries(shared || {})) SHARED.set(k, String(v));
  bindInputs(inputs);
  let status = "ok";
  try {
    let value;
    let script;
    try {
      script = new vm.Script(topLevelVar(code), { filename: "cell.js" });
    } catch (e) {
      if (!/await|async|return/i.test(code)) throw e;
      script = new vm.Script(wrapAsync(code), { filename: "cell.js" });
    }
    value = script.runInContext(ctx);
    if (value && typeof value.then === "function") value = await value;
    if (value !== undefined) {
      send({ id, t: "result", data: bundle(value) });
      const j = jsonable(value);
      if (j !== undefined) send({ id, t: "returned", value: j });
    }
  } catch (e) {
    status = "error";
    // (An error made inside the cell's context is not an instance of this realm's Error: it is read by its fields.)
    const err = e && typeof e === "object" && "message" in e ? e : new Error(String(e));
    const tb = String(err.stack || err.message).split("\n").filter((l) => !/node:internal|harness/.test(l));
    send({ id, t: "error", ename: err.name || "Error", evalue: String(err.message), traceback: tb });
  }
  send({ id, t: "done", status });
  CUR = null;
}

const variables = () => Object.keys(ctx)
  .filter((k) => !["console", "display", "require", "process", "Buffer", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "setImmediate", "queueMicrotask", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "fetch", "AbortController", "structuredClone", "performance", "globalThis", "zeff", "Table", "sharedStorage"].includes(k))
  .map((k) => { let p; try { p = util.inspect(ctx[k], { depth: 1, breakLength: Infinity }); } catch { p = "<unprintable>"; } return { name: k, type: ctx[k] === null ? "null" : Array.isArray(ctx[k]) ? "Array" : typeof ctx[k], preview: p.length > 120 ? p.slice(0, 120) + "…" : p, ...(ctx[k] && typeof ctx[k].length === "number" ? { size: ctx[k].length } : {}) }; })
  .slice(0, 300);

function complete(code, pos) {
  const head = code.slice(0, pos);
  const m = /[A-Za-z_$][\w$.]*$/.exec(head);
  const word = m ? m[0] : "";
  const dot = word.lastIndexOf(".");
  const base = dot >= 0 ? word.slice(0, dot) : "";
  const prefix = dot >= 0 ? word.slice(dot + 1) : word;
  let names = [];
  try {
    const obj = base ? vm.runInContext(base, ctx, { timeout: 200 }) : ctx;
    for (let o = Object(obj), n = 0; o && n < 4; o = Object.getPrototypeOf(o), n++) names.push(...Object.getOwnPropertyNames(o));
  } catch {}
  const items = [...new Set(names)].filter((n) => n.startsWith(prefix) && !n.startsWith("__")).sort().slice(0, 80).map((n) => (base ? base + "." + n : n));
  return { from: pos - word.length, to: pos, items };
}

let chain = Promise.resolve();
send({ t: "ready", version: process.version });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.op === "execute") chain = chain.then(() => runCell(req.id, req.code, req.inputs, req.shared));
  else if (req.op === "vars") send({ id: req.id, t: "vars", items: variables() });
  else if (req.op === "complete") send({ id: req.id, t: "complete", ...complete(req.code || "", Number(req.pos) || 0) });
  else if (req.op === "reply") {
    const w = waiting.get(req.rid);
    if (w) {
      waiting.delete(req.rid);
      if (req.ok) w.resolve(req.value);
      else w.reject(Object.assign(new Error(String(req.error)), { name: String(req.error).startsWith("Permission denied") ? "PermissionError" : "ZeffError" }));
    }
  } else if (req.op === "shutdown") process.exit(0);
}).on("close", () => process.exit(0));
process.on("unhandledRejection", (e) => { if (CUR) send({ id: CUR, t: "stream", name: "stderr", text: "Unhandled rejection: " + util.inspect(e) + "\n" }); });
`;
