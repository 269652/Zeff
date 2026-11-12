import "@/plugins/contributions"; // (the languages of the installed plugins register themselves there)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR, currentAccountId, withAccount } from "@/db/accounts";
import type { Bridge, CellStatus, Kernel } from "./kernel";
import { addGrant, ALL_PAGES, isGranted } from "./grants";
import { accessFor, inputAccess, inputFor, readFor, type Access } from "./zeff-access";
import { sharedAccess } from "./shared-storage";
import { languageById } from "./languages";
import { ensureImage, makeContext } from "./runner";
import { addMessage, type KernelMsg, type NbOutput } from "./outputs";
import { cellTimeoutSeconds, notebookEnabled, resolveLanguage } from "./runtimes";

type Language = string;

/**
 * The running sessions: one per page and language (a notebook keeps its Python apart from its Node.js), made when the first cell
 * runs and ended after half an hour of nothing. A cell is started (startExecution) and its outputs read as they come
 * (readExecution) — a long cell shows what it has printed so far. Cells of one session run one after the other. Server only.
 */

export type Execution = {
  id: string;
  session: string;
  language: Language;
  /** The number of this run in its session ("In [3]"). */
  count: number;
  status: "queued" | "running" | CellStatus;
  outputs: NbOutput[];
  /** Counts up with every change, so a reader asks only for what is new. */
  rev: number;
  startedAt: number;
  endedAt?: number;
  /** What the code asked for and may not yet read: the cell waits for your answer (the page shows the question). */
  permissions: Permission[];
  /** What the cell handed on as its output (its last expression, or a top-level return): JSON; none: nothing. */
  returned?: unknown;
  /** The account it runs for: what the code asks of Zeff (a kernel is shared, its messages arrive from elsewhere) is answered in this one. */
  account?: string;
  /** Stops and starts the cell's time limit (it does not run down while it waits for you). */
  clock?: { pause(): void; resume(): void };
};

export type Permission = { id: string; key: string; label: string; description: string; /** Changes something in Zeff (not only reads it). */ write: boolean };
export type Answer = "page" | "always" | "deny";

type Session = { kernelVersion?: string; key: string; language: Language; dir: string; kernel: Kernel | null; starting: Promise<Kernel> | null; count: number; chain: Promise<unknown>; current: Execution | null; lastUsed: number; generation: number };

const G = globalThis as unknown as { __znbSessions?: Map<string, Session>; __znbExecs?: Map<string, Execution>; __znbReaper?: NodeJS.Timeout; __znbAsks?: Map<string, { ex: Execution; resolve: (a: Answer) => void; promise: Promise<Answer>; timer: NodeJS.Timeout }> };
const sessions = (G.__znbSessions ??= new Map());
const execs = (G.__znbExecs ??= new Map());

const IDLE_MS = 30 * 60_000;
const MAX_EXECS = 400;

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 60) || "page";
/** A session's folder: where its cells' files and what its code writes (relative paths) land. */
export const sessionDir = (key: string): string => path.join(BASE_DIR, "notebooks", safe(key));
const sessionId = (key: string, language: Language) => `${safe(key)}:${language}`;

function reaper() {
  if (G.__znbReaper) return;
  G.__znbReaper = setInterval(() => {
    for (const [id, s] of sessions) {
      if (Date.now() - s.lastUsed <= IDLE_MS || s.current) continue;
      s.kernel?.kill();
      sessions.delete(id);
    }
  }, 60_000);
  G.__znbReaper.unref();
}

function guard() {
  if (!notebookEnabled()) throw new Error("Running code is switched off — turn it on in Settings → Notebook.");
}

function sessionFor(key: string, language: Language): Session {
  const id = sessionId(key, language);
  let s = sessions.get(id);
  if (!s) {
    s = { key, language, dir: sessionDir(key), kernel: null, starting: null, count: 0, chain: Promise.resolve(), current: null, lastUsed: Date.now(), generation: 0 };
    sessions.set(id, s);
    reaper();
  }
  return s;
}

/** The session's kernel, started where its language runs (a container, or this computer); `note`: what is said to the cell that waits. */
async function kernelOf(s: Session, note: (text: string) => void): Promise<Kernel> {
  const current = languageById(s.language)?.version;
  if (s.kernel?.alive() && s.kernelVersion === current) return s.kernel;
  if (s.kernel?.alive()) {
    // (Zeff's program for this language was updated since the session started: it would lack what is new — it starts again.)
    s.kernel.kill();
    s.kernel = null;
    note("[Zeff's kernel for this language was updated: the session starts again, its variables are gone.]\n");
  }
  s.starting ??= (async () => {
    const r = await resolveLanguage(s.language);
    if (r.where === "docker") await ensureImage(r.image, note);
    const k = await r.lang.start(makeContext(r.lang, s.dir, r.where, r.image, r.hostProgram, note));
    s.kernel = k;
    s.kernelVersion = r.lang.version;
    return k;
  })().finally(() => (s.starting = null));
  return s.starting;
}

/** A cell queued in its session; what it has output so far is in the execution (readExecution). */
/** `inputs`: what the cell reads (a table, a result, a database), delivered to its code as `inputs[name]`; `name`: its output is published under it. */
export function startExecution(input: { session: string; language: string; code: string; inputs?: string[]; name?: string; /** Arguments handed to the code as `inputs` (and variables): a function's. */ args?: Record<string, unknown> }): Execution {
  guard();
  if (!languageById(String(input.language))) throw new Error(`No such language: ${String(input.language).slice(0, 20)} (is its plugin installed?).`);
  const code = String(input.code ?? "");
  if (code.length > 400_000) throw new Error("That cell is too long to run.");
  const s = sessionFor(String(input.session || "page"), String(input.language));
  s.lastUsed = Date.now();
  const ex: Execution = { id: crypto.randomBytes(8).toString("hex"), session: sessionId(s.key, s.language), language: s.language, count: ++s.count, status: "queued", outputs: [], rev: 0, startedAt: Date.now(), permissions: [], account: currentAccountId() };
  execs.set(ex.id, ex);
  if (execs.size > MAX_EXECS) for (const [k, e] of execs) if (e.endedAt && execs.size > MAX_EXECS) execs.delete(k);
  const gen = s.generation;
  const note = (m: KernelMsg) => {
    if (m.t === "returned") {
      // (Its output: kept for the page, not shown among the outputs; too big a value is dropped with a note.)
      if (JSON.stringify(m.value ?? null).length <= 1_500_000) ex.returned = m.value;
      else addMessage(ex.outputs, { t: "stream", name: "stderr", text: "[the returned value is too big to keep]\n" }, ex.count);
      ex.rev++;
      return;
    }
    if (ex.status === "running" || ex.status === "queued") {
      addMessage(ex.outputs, m, ex.count);
      ex.rev++;
    }
  };
  s.chain = s.chain.then(async () => {
    // (Stopped, or the session restarted, while it waited: it does not run.)
    if (ex.status !== "queued" || gen !== s.generation) {
      if (ex.status === "queued") Object.assign(ex, { status: "aborted" as const, endedAt: Date.now() });
      ex.rev++;
      return;
    }
    ex.status = "running";
    s.current = ex;
    ex.rev++;
    let timer: NodeJS.Timeout | undefined;
    let left = cellTimeoutSeconds() * 1000;
    let armedAt = 0;
    try {
      const k = await kernelOf(s, (text) => note({ t: "stream", name: "stderr", text }));
      const arm = () => {
        armedAt = Date.now();
        timer = setTimeout(() => {
          note({ t: "stream", name: "stderr", text: `\n[stopped after ${cellTimeoutSeconds()} seconds]\n` });
          k.interrupt();
        }, left);
      };
      ex.clock = {
        pause: () => {
          if (!timer) return;
          clearTimeout(timer);
          timer = undefined;
          left = Math.max(1000, left - (Date.now() - armedAt));
        },
        resume: () => {
          if (!timer) arm();
        },
      };
      arm();
      // What the cell reads comes first: each input needs its permission (asked now), then it is handed to the code.
      const pageId = pageOfSession(s.key);
      const delivered: Record<string, unknown> = { ...(input.args ?? {}) };
      for (const name of (input.inputs ?? []).slice(0, 20)) {
        if (!pageId) throw new Error("Permission denied: inputs need a page of Zeff.");
        await ensure(ex, pageId, await inputAccess(name));
        delivered[name] = await inputFor(pageId, name);
      }
      const status = await k.execute(ex.id, code, note, bridgeFor(ex, s.key), delivered, sharedAccess(s.key, (text) => note({ t: "stream", name: "stderr", text })));
      // Its output, published under the cell's name for widgets and the rest of Zeff (a permission of its own: it writes).
      const outName = String(input.name ?? "").trim();
      if (status === "ok" && outName && ex.returned !== undefined && pageId) {
        try {
          await ensure(ex, pageId, await accessFor({ op: "publish", args: { name: outName } }));
          await readFor(pageId, { op: "publish", args: { name: outName, value: ex.returned } });
        } catch (e) {
          note({ t: "stream", name: "stderr", text: `[not published: ${e instanceof Error ? e.message : String(e)}]\n` });
        }
      }
      // (Only now it is done: a reader that sees "ok" finds the returned value and the published output.)
      if (ex.status === "running") ex.status = status;
    } catch (e) {
      note({ t: "error", ename: "StartError", evalue: e instanceof Error ? e.message : String(e), traceback: [] });
      ex.status = "error";
    } finally {
      clearTimeout(timer);
      denyPending(ex);
      ex.endedAt = Date.now();
      ex.rev++;
      s.current = null;
      s.lastUsed = Date.now();
    }
  });
  return ex;
}

/** What a run has output (nothing new: just the status). */
export function readExecution(id: string, knownRev = -1): { found: boolean; status?: Execution["status"]; count?: number; rev?: number; outputs?: NbOutput[]; permissions?: Permission[]; returned?: unknown } {
  const ex = execs.get(String(id));
  if (!ex) return { found: false };
  return { found: true, status: ex.status, count: ex.count, rev: ex.rev, permissions: ex.permissions, ...(ex.rev !== knownRev ? { outputs: ex.outputs } : {}), ...(ex.endedAt && ex.returned !== undefined ? { returned: ex.returned } : {}) };
}

/** Stop the cell that runs (and those waiting behind it). */
export function interruptSession(session: string, language: string): boolean {
  const s = sessions.get(sessionId(session, language));
  if (!s) return false;
  s.generation++;
  for (const e of execs.values()) if (e.session === sessionId(session, language) && e.status === "queued") Object.assign(e, { status: "aborted" as const, endedAt: Date.now(), rev: e.rev + 1 });
  if (s.current) s.kernel?.interrupt();
  return true;
}

/** The session ended: its variables are gone, the next cell starts a new one. */
export function restartSession(session: string, language: string): boolean {
  const id = sessionId(session, language);
  const s = sessions.get(id);
  if (!s) return false;
  interruptSession(session, language);
  s.kernel?.kill();
  s.kernel = null;
  s.count = 0;
  return true;
}

export function endAllSessions(): void {
  for (const s of sessions.values()) s.kernel?.kill();
  sessions.clear();
}

/** The session's variables, or completions at a place in a cell (nothing while there is no session). */
export async function askSession(session: string, language: string, op: "vars" | "complete", args: { code?: string; pos?: number } = {}): Promise<Record<string, unknown>> {
  guard();
  const s = sessions.get(sessionId(session, language));
  if (!s?.kernel?.alive()) return {};
  s.lastUsed = Date.now();
  return s.kernel.request(op, { code: String(args.code ?? "").slice(0, 100_000), pos: Number(args.pos) || 0 });
}

/** Whether a session of this page and language is there. */
export const hasSession = (session: string, language: string): boolean => !!sessions.get(sessionId(session, language))?.kernel?.alive();

/** A session's folder removed (its files). */
export function clearSessionFiles(key: string): void {
  fs.rmSync(sessionDir(key), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The permission layer: what code may read of Zeff
// ---------------------------------------------------------------------------

type Ask = { ex: Execution; resolve: (a: Answer) => void; promise: Promise<Answer>; timer: NodeJS.Timeout };
const asks = (G.__znbAsks ??= new Map<string, Ask>());
const ASK_MS = 10 * 60_000;

/** The page a session belongs to (its key is "page-<id>"); 0: none. */
const pageOfSession = (key: string): number => Number(/^page-(\d+)$/.exec(key)?.[1] ?? 0);

/** The cell waits: the question is put on the run, the answer comes from answerPermission (or "deny" after ten minutes). */
function askPermission(ex: Execution, access: Access): Promise<Answer> {
  const same = ex.permissions.find((p) => p.key === access.key);
  if (same && asks.has(same.id)) return asks.get(same.id)!.promise;
  const id = crypto.randomBytes(6).toString("hex");
  let resolve!: (a: Answer) => void;
  const promise = new Promise<Answer>((r) => (resolve = r));
  const timer = setTimeout(() => answerPermission(ex.id, id, "deny"), ASK_MS);
  asks.set(id, { ex, resolve, promise, timer });
  ex.permissions.push({ id, key: access.key, label: access.label, description: access.description, write: !!access.write });
  ex.clock?.pause();
  ex.rev++;
  return promise;
}

/** Your answer to a question a cell put: allowed for this page, for every page, or refused. An allowed one is kept — and the code goes on. */
export function answerPermission(execId: string, permissionId: string, answer: string): boolean {
  const ask = asks.get(permissionId);
  if (!ask || ask.ex.id !== execId) return false;
  const a: Answer = answer === "page" || answer === "always" ? answer : "deny";
  clearTimeout(ask.timer);
  asks.delete(permissionId);
  const perm = ask.ex.permissions.find((p) => p.id === permissionId);
  ask.ex.permissions = ask.ex.permissions.filter((p) => p.id !== permissionId);
  if (a !== "deny" && perm) addGrant(a === "always" ? ALL_PAGES : String(pageOfSession(ask.ex.session.split(":")[0])), perm.key);
  if (!ask.ex.permissions.length) ask.ex.clock?.resume();
  ask.ex.rev++;
  ask.resolve(a);
  return true;
}

/** A run ended (stopped, timed out) with questions open: they are refused. */
function denyPending(ex: Execution): void {
  for (const p of [...ex.permissions]) answerPermission(ex.id, p.id, "deny");
}

/** The permission is there, or the cell stops and asks; a refusal ends the request with an error that starts with "Permission denied". */
async function ensure(ex: Execution, pageId: number, access: Access, scope: string = String(pageId)): Promise<void> {
  if (isGranted(scope, access.key)) return;
  // A function of a plugin runs without anyone to ask: what it was not granted (Settings → Notebook → Functions) is refused.
  if (scope.startsWith("fn:")) throw new Error(`Permission denied: this function may not ${access.write ? access.label : `read ${access.label}`} — grant it under Settings → Notebook (Functions).`);
  if ((await askPermission(ex, access)) === "deny") throw new Error(`Permission denied: the code may not ${access.write ? access.label : `read ${access.label}`}.`);
}

/** What the code of a run may ask of Zeff: each request needs a permission — kept ones pass, others are asked for. */
function bridgeFor(ex: Execution, sessionKey: string): Bridge {
  const inner: Bridge = async (req) => {
    try {
      const pageId = pageOfSession(sessionKey);
      const fn = /^fn-([a-z0-9-]+)(?:\.\d+)?$/.exec(sessionKey)?.[1];
      if (!pageId && !fn) return { ok: false, error: "Permission denied: this notebook is not a page of Zeff." };
      await ensure(ex, pageId, await accessFor(req), fn ? `fn:${fn}` : String(pageId));
      return { ok: true, value: await readFor(pageId, req) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  return (req) => (ex.account ? withAccount(ex.account, () => inner(req)) : inner(req));
}
