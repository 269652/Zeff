/**
 * Signs of life a clock didn't have to be told: what the agent's own session wrote while it worked. Agents forget to ping
 * (todo_clock_ping) while they're deep in the work — but their clients keep a log of the session, and the session that
 * started a todo's clock (start_todo or todo_clock_start with that todo) is working on it:
 *   Claude Code     ~/.claude/projects/<folder>/<session>.jsonl              every step with its time
 *   Copilot CLI     ~/.copilot/session-state/<session>/events.jsonl          every event with its time
 *   VS Code Copilot <VS Code>/User/workspaceStorage/<ws>/chatSessions/*.jsonl each request: its start and when it completed
 * Each step is a sign of life, as a ping would be (a request in VS Code: the whole time it ran). Measured, not guessed — a
 * silence of more than PING_MINUTES between them still isn't counted. Read when a clock's ping is overdue; each log read on
 * only from where it was (they only grow). Server only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Kind = "claude" | "copilot" | "vscode";

/** Where each client keeps its logs (ZEFF_CLAUDE_PROJECTS, ZEFF_COPILOT_SESSIONS, ZEFF_VSCODE_STORAGE for tests). */
function sources(): { kind: Kind; dir: string; files: (sub: string) => string[] }[] {
  const home = os.homedir();
  const appData = process.env.APPDATA || (process.platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config"));
  const jsonl = (sub: string) => fs.readdirSync(/*turbopackIgnore: true*/ sub).filter((n) => n.endsWith(".jsonl")).map((n) => path.join(sub, n));
  return [
    { kind: "claude", dir: process.env.ZEFF_CLAUDE_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects"), files: jsonl },
    { kind: "copilot", dir: process.env.ZEFF_COPILOT_SESSIONS || path.join(home, ".copilot", "session-state"), files: (sub) => [path.join(sub, "events.jsonl")] },
    { kind: "vscode", dir: process.env.ZEFF_VSCODE_STORAGE || path.join(appData, "Code", "User", "workspaceStorage"), files: (sub) => jsonl(path.join(sub, "chatSessions")) },
  ];
}

/**
 * A log as read so far. tail: bytes at the end not read as a line yet (still being written); vscode: its requests' starts
 * (by their place in the session) — their ends come in later lines.
 */
type Parsed = { mtime: number; size: number; tail: number; started: Set<string>; times: number[]; requests?: number[] };
const state = globalThis as { __zeffClockLogs?: Map<string, Parsed> };
const parsed = (state.__zeffClockLogs ??= new Map());

/** The logs there are, with when each was last written (a listing — looked at only when a clock's ping is overdue). */
function logs(): { kind: Kind; file: string; mtime: number }[] {
  const out: { kind: Kind; file: string; mtime: number }[] = [];
  for (const s of sources()) {
    let subs: string[] = [];
    try {
      subs = fs.readdirSync(/*turbopackIgnore: true*/ s.dir);
    } catch {
      continue; // that client isn't here
    }
    for (const sub of subs) {
      let files: string[] = [];
      try {
        files = s.files(path.join(s.dir, sub));
      } catch {
        continue;
      }
      for (const file of files) {
        try {
          out.push({ kind: s.kind, file, mtime: fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs });
        } catch {
          // not there (yet), or gone
        }
      }
    }
  }
  return out;
}

/**
 * The todos whose clock a step started: a tool call (Claude's tool_use, Copilot's tool event, VS Code's toolInvocation) of
 * Zeff's start_todo / todo_clock_start with its todo — or the same call made another way, a script or curl, with the tool's
 * name and `"todo":"T-…"` right after it in the call's input. Only calls the session made, not what it wrote or read.
 */
const TOOL = /(?:^|[_./-])(?:start_todo|todo_clock_start)$/;
const CALLED = /(?:start_todo|todo_clock_start)[^\n]{0,60}?"todo"\s*:\s*"(T-\d+)"/g;
function startedIn(o: unknown, into: Set<string>, depth = 0): void {
  if (!o || typeof o !== "object" || depth > 12) return;
  const r = o as Record<string, unknown>;
  const name = [r.name, r.toolName, r.toolId].find((v): v is string => typeof v === "string");
  if (name) {
    const inputs = [r.input, r.arguments, r.args, r.rawInput, (r.toolSpecificData as { rawInput?: unknown } | undefined)?.rawInput];
    for (const v of inputs) {
      if (TOOL.test(name)) {
        const todo = typeof v === "string" ? /"todo"\s*:\s*"(T-\d+)"/.exec(v)?.[1] : (v as { todo?: unknown } | undefined)?.todo;
        if (typeof todo === "string") into.add(todo.trim().toUpperCase());
      }
      // Another tool (a shell) that makes the call: its command.
      const texts = typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).filter((x): x is string => typeof x === "string") : [];
      for (const s of texts) for (const m of s.matchAll(CALLED)) into.add(m[1].toUpperCase());
    }
  }
  for (const v of Array.isArray(o) ? o : Object.values(r)) if (v && typeof v === "object") startedIn(v, into, depth + 1);
}

/** Every few minutes of a span (a VS Code request that ran): signs of life as close as the clock needs them. */
function span(from: number, to: number, into: number[]): void {
  for (let t = from; t < to; t += 4 * 60000) into.push(t);
  into.push(to);
}

/** One line of a log: what it says about the steps' times and the clocks started. */
function readLine(kind: Kind, line: string, p: Parsed, mtime: number): void {
  const mayStart = line.includes("start_todo") || line.includes("todo_clock_start");
  if (kind !== "vscode") {
    const at = /"timestamp":\s*"([^"]+)"/.exec(line)?.[1];
    const ms = at ? Date.parse(at) : NaN;
    if (Number.isFinite(ms)) p.times.push(ms);
    if (mayStart) {
      try {
        startedIn(JSON.parse(line), p.started);
      } catch {
        // not a whole line
      }
    }
    return;
  }
  // VS Code: the session (kind 0), then changes to it — requests added (kind 2 at ["requests"]), their state set (kind 1).
  let j: { kind?: number; k?: unknown[]; v?: unknown };
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (mayStart) startedIn(j, p.started);
  const reqs = (p.requests ??= []);
  const added = (list: unknown) => {
    for (const r of Array.isArray(list) ? list : []) {
      const at = Number((r as { timestamp?: unknown }).timestamp);
      reqs.push(Number.isFinite(at) ? at : NaN);
      const done = Number((r as { modelState?: { completedAt?: unknown } }).modelState?.completedAt);
      if (Number.isFinite(at)) Number.isFinite(done) ? span(at, done, p.times) : p.times.push(at);
    }
  };
  const k = Array.isArray(j.k) ? j.k : [];
  if (j.kind === 0) added((j.v as { requests?: unknown } | undefined)?.requests);
  else if (j.kind === 2 && k.length === 1 && k[0] === "requests") added(j.v);
  else if (j.kind === 1 && k[0] === "requests" && k[2] === "modelState") {
    const at = reqs[Number(k[1])];
    const done = Number((j.v as { completedAt?: unknown } | undefined)?.completedAt);
    if (Number.isFinite(at) && Number.isFinite(done)) span(at, done, p.times);
  } else if (k[0] === "requests") {
    // A request still answering: its log grows — the last write is a sign of life.
    p.times.push(mtime);
  }
}

/** A log's steps — only what was appended since the last read (they only grow; a session's can be large). */
function parse(kind: Kind, file: string, mtime: number): Parsed | null {
  let size = 0;
  try {
    size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  } catch {
    return null;
  }
  const kept = parsed.get(file);
  if (kept && kept.mtime === mtime && kept.size === size) return kept;
  // Grown: read on from where it was (a line cut off then is read whole now); else from the start.
  const from = kept && size > kept.size ? kept.size - kept.tail : 0;
  let text = "";
  try {
    const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const p: Parsed = from ? { ...kept!, mtime, size } : { mtime, size, tail: 0, started: new Set(), times: [] };
  const lines = text.split("\n");
  // The last piece without its line end yet: read again next time.
  const rest = text.endsWith("\n") ? "" : lines.pop()!;
  for (const line of lines) if (line) readLine(kind, line, p, mtime);
  p.times.sort((a, b) => a - b);
  p.tail = Buffer.byteLength(rest);
  parsed.set(file, p);
  return p;
}

/** The steps (their times, sorted) of the sessions that started a clock on this todo, between `from` and `to`. */
export function sessionActivity(todoRef: string, from: number, to: number): number[] {
  const ref = todoRef.toUpperCase();
  const out: number[] = [];
  for (const { kind, file, mtime } of logs()) {
    if (mtime < from) continue; // nothing written since
    const p = parse(kind, file, mtime);
    if (!p?.started.has(ref)) continue;
    for (const t of p.times) if (t > from && t <= to) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
