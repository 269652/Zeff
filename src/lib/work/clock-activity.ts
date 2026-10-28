/**
 * Signs of life a clock didn't have to be told: what the agent's own session wrote while it worked. Agents forget to ping
 * (todo_clock_ping) while they're deep in the work — Claude Code keeps a transcript of every step it takes (each line with
 * its time, ~/.claude/projects/<folder>/<session>.jsonl), and the session that started a todo's clock (start_todo or
 * todo_clock_start with that todo) is working on it: each of its steps is a sign of life, as a ping would be. Measured, not
 * guessed — a silence of more than PING_MINUTES between its steps still isn't counted. Read when a clock is settled; each
 * file parsed once per change. Server only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where Claude Code keeps its transcripts (ZEFF_CLAUDE_PROJECTS for tests). */
const projectsDir = () => process.env.ZEFF_CLAUDE_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");

/** tail: bytes at the end not read as a line yet (still being written). */
type Parsed = { mtime: number; size: number; tail: number; started: Set<string>; times: number[] };
const state = globalThis as { __zeffClockTranscripts?: Map<string, Parsed> };
const parsed = (state.__zeffClockTranscripts ??= new Map());

/** The transcripts there are, with when each was last written (a listing — looked at only when a clock's ping is overdue). */
function transcripts(): { file: string; mtime: number }[] {
  const dir = projectsDir();
  const files: { file: string; mtime: number }[] = [];
  let folders: string[] = [];
  try {
    folders = fs.readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    // no Claude Code here
  }
  for (const f of folders) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(/*turbopackIgnore: true*/ path.join(dir, f)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const file = path.join(dir, f, n);
        files.push({ file, mtime: fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs });
      } catch {
        // gone meanwhile
      }
    }
  }
  return files;
}

/**
 * The todos whose clock a step of the session started: Zeff's MCP tool called directly (mcp__zeff__start_todo with its todo),
 * or the same call made another way — a script, curl — with the tool's name and `"todo":"T-…"` right after it in the
 * command. Only steps the session took (tool_use), not what it wrote or read.
 */
const CALLED = /(?:start_todo|todo_clock_start)[^\n]{0,60}?"todo"\s*:\s*"(T-\d+)"/g;
function startedIn(line: string, into: Set<string>): void {
  if (!line.includes("start_todo") && !line.includes("todo_clock_start")) return;
  let j: { message?: { content?: unknown } };
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  const parts = Array.isArray(j.message?.content) ? (j.message!.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) : [];
  for (const p of parts) {
    if (p.type !== "tool_use" || !p.input) continue;
    if (/__(?:start_todo|todo_clock_start)$/.test(p.name ?? "") && typeof p.input.todo === "string") into.add(p.input.todo.trim().toUpperCase());
    for (const v of Object.values(p.input)) if (typeof v === "string") for (const m of v.matchAll(CALLED)) into.add(m[1].toUpperCase());
  }
}

/** A transcript's steps — only what was appended since the last read (they only grow; a session's can be large). */
function parse(file: string, mtime: number): Parsed | null {
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
  const started = from ? kept!.started : new Set<string>();
  const times: number[] = from ? kept!.times : [];
  const lines = text.split("\n");
  // The last piece without its line end yet: read again next time.
  const rest = text.endsWith("\n") ? "" : lines.pop()!;
  for (const line of lines) {
    if (!line) continue;
    startedIn(line, started);
    const at = /"timestamp":"([^"]+)"/.exec(line)?.[1];
    const ms = at ? Date.parse(at) : NaN;
    if (Number.isFinite(ms)) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const p = { mtime, size, tail: Buffer.byteLength(rest), started, times };
  parsed.set(file, p);
  return p;
}

/** The steps (their times, sorted) of the sessions that started a clock on this todo, between `from` and `to`. */
export function sessionActivity(todoRef: string, from: number, to: number): number[] {
  const ref = todoRef.toUpperCase();
  const out: number[] = [];
  for (const { file, mtime } of transcripts()) {
    if (mtime < from) continue; // nothing written since
    const p = parse(file, mtime);
    if (!p?.started.has(ref)) continue;
    for (const t of p.times) if (t > from && t <= to) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
