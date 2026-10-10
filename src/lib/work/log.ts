import fs from "node:fs";
import path from "node:path";
import { accountDir, currentAccountId } from "@/db/accounts";
import type { WorkLogLine } from "./shared";

/**
 * Where workers keep their logs (and Zeff its worker files): work/ next to the database —
 * data/work/, git-ignored like the DB; a snapshot's next to the snapshot, an account's in its folder.
 */
export const workDir = () => path.join(accountDir(currentAccountId()), "work");
export const logPath = (id: number) => path.join(workDir(), "logs", `${id}.jsonl`);
export const errPath = (id: number) => path.join(workDir(), "logs", `${id}.err`);

/** Claude's last event: how the session ended. */
export type StreamResult = {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  permission_denials?: { tool_name?: string; tool_input?: unknown }[];
};

type Block = { type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Event = {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  mcp_servers?: { name: string; status: string }[];
  message?: { content?: Block[] | string };
} & StreamResult;

/** Terminal colours in a CLI's plain output. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const read = (file: string) => {
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return "";
  }
};

const short = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A tool call in a few words. */
function callText(name: string, input: Record<string, unknown> = {}): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash":
    case "PowerShell":
      return short(s("command"), 220);
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return s("file_path") || s("notebook_path");
    case "Grep":
      return short(`${s("pattern")}${s("path") ? `  in ${s("path")}` : ""}`, 200);
    case "Glob":
      return s("pattern");
    case "WebFetch":
      return s("url");
    case "WebSearch":
      return s("query");
    case "Skill":
      return s("skill") || s("command");
    case "Task":
    case "Agent":
      return short(s("description") || s("prompt"), 160);
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
      return short(todos.map((t) => `${t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "·"} ${t.content ?? ""}`).join("  "), 300);
    }
    case "StructuredOutput":
      return "the result";
    default:
      return short(JSON.stringify(input), 200);
  }
}

/** A tool result's text, however it came. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : typeof (c as Block)?.text === "string" ? (c as Block).text : "")).join("\n");
  return "";
}

/** The end of a long output: its last lines that say something. */
const tail = (text: string, lines: number, max: number) =>
  short(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-lines)
      .join("  ⏎  "),
    max,
  );

/**
 * A run's log as the Work tab shows it: Claude's stream (JSON lines) condensed — its words,
 * its tool calls in short, failed calls, the ends of command outputs, what the permission mode
 * refused, how it ended — and, for a plain-text CLI (Copilot) or a failure, the lines as they
 * are. Only whole lines (the last one may still be being written), so a line's place never
 * changes: read on from where you were. Also Claude's final event, and the error output's last
 * lines (apart: it grows on its own).
 */
export function readLog(id: number): { lines: WorkLogLine[]; errors: string[]; result: StreamResult | null; sessionId: string | null; cwd: string | null } {
  const raw = read(logPath(id));
  const whole = raw.endsWith("\n") ? raw : raw.slice(0, raw.lastIndexOf("\n") + 1);
  const lines: WorkLogLine[] = [];
  const tools = new Map<string, string>();
  let result: StreamResult | null = null;
  let sessionId: string | null = null;
  let cwd: string | null = null;
  for (const line of whole.split("\n")) {
    if (!line.trim()) continue;
    let e: Event;
    try {
      e = JSON.parse(line) as Event;
    } catch {
      lines.push({ k: "raw", text: line.replace(ANSI, "") });
      continue;
    }
    if (e.type === "system" && e.subtype === "init") {
      sessionId = e.session_id ?? sessionId;
      cwd = e.cwd ?? cwd;
      const mcp = (e.mcp_servers ?? []).map((m) => `${m.name}${m.status === "connected" ? "" : ` (${m.status})`}`).join(", ");
      lines.push({ k: "start", model: e.model, text: [e.model, e.cwd, e.permissionMode && `permissions: ${e.permissionMode}`, mcp && `MCP: ${mcp}`].filter(Boolean).join(" · ") });
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === "text" && b.text?.trim()) lines.push({ k: "say", text: b.text.trim() });
        else if (b.type === "tool_use" && b.name) {
          if (b.id) tools.set(b.id, b.name);
          lines.push({ k: "tool", tool: b.name.replace(/^mcp__/, ""), text: callText(b.name, b.input) });
        }
      }
    } else if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type !== "tool_result") continue;
        const text = resultText(b.content);
        const tool = tools.get(b.tool_use_id ?? "") ?? "";
        if (b.is_error) lines.push({ k: "out", error: true, text: short(text, 400) });
        else if ((tool === "Bash" || tool === "PowerShell") && text.trim()) lines.push({ k: "out", text: tail(text, 3, 300) });
      }
    } else if (e.type === "result") {
      result = e;
      sessionId = e.session_id ?? sessionId;
      for (const d of e.permission_denials ?? []) lines.push({ k: "deny", text: `${d.tool_name ?? "?"}: ${callText(d.tool_name ?? "", (d.tool_input ?? {}) as Record<string, unknown>)}` });
      const cost = typeof e.total_cost_usd === "number" ? ` · $${e.total_cost_usd.toFixed(2)}` : "";
      const turns = e.num_turns ? ` · ${e.num_turns} turns` : "";
      lines.push(
        e.is_error || e.subtype !== "success"
          ? { k: "end", ok: false, text: `Ended (${e.subtype ?? "error"})${turns}${cost}${e.result ? ` — ${short(e.result, 300)}` : ""}` }
          : { k: "end", ok: true, text: `Finished${turns}${cost}` },
      );
    }
  }
  const errors = read(errPath(id))
    .split("\n")
    .map((l) => l.replace(ANSI, "").trimEnd())
    .filter((l) => l.trim())
    .slice(-20);
  return { lines, errors, result, sessionId, cwd };
}

/** The plain text a CLI printed (Copilot's answer is in it). */
export function readOutput(id: number): string {
  return read(logPath(id));
}

/** The error output, its last lines. */
export function readErrors(id: number, max = 1500): string {
  const t = read(errPath(id)).trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

/**
 * What a run did on the way, in order — an interactive Copilot session's tool calls (✗ when one
 * failed) and your answers in it, or Claude's tool uses (with the file or command) — at most 30.
 */
export function runActions(runId: number): string[] {
  let raw = "";
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ logPath(runId), "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  const push = (a: string) => {
    const s = a.replace(/\s+/g, " ").trim().slice(0, 200);
    if (s && out[out.length - 1] !== s) out.push(s);
  };
  for (const line of raw.split(/\r?\n/)) {
    const tool = /^▸ (.+)$/.exec(line);
    if (tool) push(tool[1]);
    else if (/^\s+✗ (fehlgeschlagen|failed)/.test(line) && out.length) out[out.length - 1] = `${out[out.length - 1]} ✗`;
    else if (line.startsWith("[Du] ")) push(`Du: ${line.slice(5)}`);
    else if (line.startsWith("{")) {
      try {
        const e = JSON.parse(line) as Event;
        for (const b of (e.message?.content as Block[] | undefined) ?? []) {
          if (b.type !== "tool_use" || !b.name) continue;
          const i = b.input ?? {};
          const what = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? "";
          push(`${b.name}${what ? `: ${String(what)}` : ""}`);
        }
      } catch {
        // not an event
      }
    }
  }
  return out.slice(0, 30);
}
