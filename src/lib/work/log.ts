import fs from "node:fs";
import path from "node:path";
import { accountDir, currentAccountId } from "@/db/accounts";
import { t } from "@/lib/i18n/server";
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
  isReplay?: boolean;
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
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
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
      return short(todos.map((x) => `${x.status === "completed" ? "✓" : x.status === "in_progress" ? "▸" : "·"} ${x.content ?? ""}`).join("  "), 300);
    }
    case "StructuredOutput":
      return t("the result");
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
/** What Zeff sent a live session besides your messages (answers to what it asked, interrupts, mode switches) — beside its log. */
export const inPath = (id: number) => path.join(workDir(), "logs", `${id}.in.jsonl`);

/** Zeff's answers to a live session's questions, by request: from the side log. */
function answersOf(id: number): Map<string, InMsg["response"]> {
  const out = new Map<string, InMsg["response"]>();
  for (const line of read(inPath(id)).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const m = (JSON.parse(line) as { msg?: InMsg }).msg;
      if (m?.type === "control_response" && m.response?.request_id) out.set(m.response.request_id, m.response);
    } catch {
      // half written
    }
  }
  return out;
}

/** Your answer to a question, in a few words. */
function answerText(res: InMsg["response"]): { answer: string; ok: boolean } {
  const r = res?.response ?? {};
  const answers = (r.updatedInput as { answers?: Record<string, string> } | undefined)?.answers;
  const plan = Array.isArray(r.updatedPermissions) ? (r.updatedPermissions as { type?: string; mode?: string }[]).find((p) => p.type === "setMode") : undefined;
  if (r.behavior !== "allow")
    return {
      ok: false,
      answer: `${r.message?.toString().startsWith("Nobody") ? t("denied (nobody answered in time)") : t("denied")}${typeof r.message === "string" && !/^(The user said no|Nobody answered)/.test(r.message) ? `: ${short(r.message, 300)}` : ""}${r.interrupt ? ` — ${t("and stopped")}` : ""}`,
    };
  return {
    ok: true,
    answer: answers
      ? Object.entries(answers)
          .map(([q, a]) => `${short(q, 80)} → ${a}`)
          .join(" · ")
      : plan
        ? t("approved — on in {mode}", { mode: plan.mode ?? "" })
        : Array.isArray(r.updatedPermissions) && r.updatedPermissions.length
          ? t("allowed — always")
          : t("allowed"),
  };
}

export function readLog(id: number): { lines: WorkLogLine[]; errors: string[]; result: StreamResult | null; sessionId: string | null; cwd: string | null } {
  const raw = read(logPath(id));
  const whole = raw.endsWith("\n") ? raw : raw.slice(0, raw.lastIndexOf("\n") + 1);
  const lines: WorkLogLine[] = [];
  const tools = new Map<string, string>();
  // A live session: Zeff's answers to what it asked (beside the log).
  const answers = answersOf(id);
  let live = answers.size > 0 || fs.existsSync(/*turbopackIgnore: true*/ inPath(id));
  let mode = "";
  let result: StreamResult | null = null;
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let promptSeen = false;
  let structured: unknown;
  for (const line of whole.split("\n")) {
    if (!line.trim()) continue;
    let e: Event;
    try {
      e = JSON.parse(line) as Event;
    } catch {
      lines.push({ k: "raw", text: line.replace(ANSI, "") });
      continue;
    }
    if (e.type === "zeff_host") {
      // An administrator session's own host: when it started and ended.
      live = true;
      const x = e as unknown as { event?: string; elevated?: boolean; code?: number | null };
      if (x.event === "start") lines.push({ k: "note", text: x.elevated ? t("Session started — as administrator") : t("Session started") });
      else if (x.event === "exit") lines.push({ k: "note", text: x.code ? t("Session process ended (exit {code})", { code: x.code }) : t("Session process ended") });
    } else if (e.type === "control_request") {
      const q = (e as unknown as { request_id?: string; request?: { subtype?: string; tool_name?: string; input?: Record<string, unknown>; description?: string } }).request;
      const rid = (e as unknown as { request_id?: string }).request_id;
      if (q?.subtype === "can_use_tool" && rid) {
        const tool = q.tool_name ?? "?";
        const text =
          tool === "ExitPlanMode"
            ? t("Its plan — go ahead?")
            : tool === "AskUserQuestion"
              ? t("Asks: {q}", { q: ((q.input?.questions as { question?: string }[] | undefined) ?? []).map((x) => x.question).join(" · ") })
              : `${tool}: ${callText(tool, q.input)}`;
        const a = answers.get(rid);
        lines.push({ k: "ask", text, ...(a ? answerText(a) : {}) });
      }
    } else if (e.type === "system" && e.subtype === "init") {
      sessionId = e.session_id ?? sessionId;
      cwd = e.cwd ?? cwd;
      // A live session prints this before each turn: once (and again when something changed).
      const mcp = (e.mcp_servers ?? []).map((m) => `${m.name}${m.status === "connected" ? "" : ` (${m.status})`}`).join(", ");
      const text = [e.model, e.cwd, e.permissionMode && t("permissions: {mode}", { mode: e.permissionMode }), mcp && `MCP: ${mcp}`].filter(Boolean).join(" · ");
      if (!live || !lines.some((l) => l.k === "start" && l.text === text)) lines.push({ k: "start", model: e.model, text });
      mode = e.permissionMode ?? mode;
    } else if (e.type === "system" && e.subtype === "status" && e.permissionMode && e.permissionMode !== mode) {
      mode = e.permissionMode;
      lines.push({ k: "note", text: t("Mode → {mode}", { mode }) });
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === "text" && b.text?.trim()) lines.push({ k: "say", text: b.text.trim() });
        else if (b.type === "tool_use" && b.name) {
          if (b.id) tools.set(b.id, b.name);
          lines.push({ k: "tool", tool: b.name.replace(/^mcp__/, ""), text: callText(b.name, b.input), ...changeOf(b.name, b.input ?? {}) });
        }
      }
    } else if (e.type === "user" && e.isReplay) {
      live = true;
      // Your message into a running session (--replay-user-messages): the first is the prompt itself.
      const c = e.message?.content as unknown;
      const blocks = Array.isArray(c) ? (c as { type?: string; text?: string }[]) : [];
      const raw = typeof c === "string" ? c : blocks.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
      const images = blocks.filter((b) => b.type === "image").length;
      // Your !commands went along with it: each as a command and its output.
      for (const m of raw.matchAll(/<bash-input>([\s\S]*?)<\/bash-input>\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>(?:\s*<bash-exit-code>(\d+)<\/bash-exit-code>)?/g))
        lines.push({ k: "shell", cmd: m[1], text: m[2].replace(ANSI, "").slice(-20000), ok: !m[3] || m[3] === "0" });
      const text = raw.replace(/<bash-input>[\s\S]*?<\/bash-input>\s*<bash-stdout>[\s\S]*?<\/bash-stdout>(\s*<bash-exit-code>\d+<\/bash-exit-code>)?\s*/g, "").trim();
      if (text.startsWith("Schließ jetzt ab:")) lines.push({ k: "note", text: t("You asked it to finish — its result ends the session") });
      else if (promptSeen && (text || images)) lines.push({ k: "you", text: text.slice(0, 20000), ...(images ? { images } : {}) });
      promptSeen = true;
    } else if (e.type === "user" && Array.isArray(e.message?.content) && e.message.content.some((b) => b.type === "text" && /^\[Request interrupted by user/.test(b.text ?? ""))) {
      lines.push({ k: "note", text: t("Stopped by you") });
    } else if (e.type === "user" && typeof e.message?.content === "string") {
      // A slash command's own output (/model, /cost …).
      const out = e.message.content.replace(/<\/?local-command-std(out|err)>/g, "").trim();
      if (out) lines.push({ k: "note", text: short(out, 400) });
    } else if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type !== "tool_result") continue;
        const text = resultText(b.content);
        const tool = tools.get(b.tool_use_id ?? "") ?? "";
        const full = text.length > 300 || text.split("\n").length > 3 ? text.slice(0, 20000) : undefined;
        if (b.is_error) lines.push({ k: "out", error: true, text: short(text, 400), ...(full ? { full } : {}) });
        else if ((tool === "Bash" || tool === "PowerShell") && text.trim()) lines.push({ k: "out", text: tail(text, 3, 300), ...(full ? { full } : {}) });
        else if (live && full && !["Read", "Edit", "Write", "MultiEdit", "TodoWrite", "ExitPlanMode", "AskUserQuestion"].includes(tool)) lines.push({ k: "out", text: tail(text, 1, 160), full });
      }
    } else if (e.type === "result") {
      // Several answers when you wrote while it worked: the last one with a structured result counts.
      if (e.structured_output !== undefined) structured = e.structured_output;
      result = structured !== undefined && e.structured_output === undefined ? { ...e, structured_output: structured } : e;
      sessionId = e.session_id ?? sessionId;
      for (const d of e.permission_denials ?? []) lines.push({ k: "deny", text: `${d.tool_name ?? "?"}: ${callText(d.tool_name ?? "", (d.tool_input ?? {}) as Record<string, unknown>)}` });
      const cost = typeof e.total_cost_usd === "number" ? ` · $${e.total_cost_usd.toFixed(2)}` : "";
      const turns = e.num_turns ? ` · ${t("{n} turns", { n: e.num_turns })}` : "";
      if (live) lines.push(e.subtype === "success" ? { k: "note", text: `${t("Turn done")}${turns}${cost}` } : e.subtype === "error_during_execution" ? { k: "note", text: t("Turn stopped") } : { k: "end", ok: false, text: `${t("Turn ended ({reason})", { reason: e.subtype ?? "error" })}${e.result ? ` — ${short(e.result, 300)}` : ""}` });
      else
        lines.push(
          e.is_error || e.subtype !== "success"
            ? { k: "end", ok: false, text: `${t("Ended ({reason})", { reason: e.subtype ?? "error" })}${turns}${cost}${e.result ? ` — ${short(e.result, 300)}` : ""}` }
            : { k: "end", ok: true, text: `${t("Finished")}${turns}${cost}` },
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

/** What Zeff sent a live session (the host logs it). */
type InMsg = {
  type?: string;
  message?: { content?: { type: string; text?: string }[] };
  request?: { subtype?: string; mode?: string; model?: string };
  response?: { request_id?: string; response?: { behavior?: string; message?: string; interrupt?: boolean; updatedInput?: unknown; updatedPermissions?: unknown } };
};

/** What a tool call changes, to show: an edit's old and new text, a written file, a long command whole. */
function changeOf(name: string, input: Record<string, unknown>): { diff?: { old: string; new: string }[]; detail?: string } {
  const s = (v: unknown, max = 8000) => (typeof v === "string" ? v.slice(0, max) : "");
  if (name === "Edit") return { diff: [{ old: s(input.old_string), new: s(input.new_string) }] };
  if (name === "MultiEdit" && Array.isArray(input.edits)) return { diff: (input.edits as Record<string, unknown>[]).slice(0, 20).map((x) => ({ old: s(x.old_string), new: s(x.new_string) })) };
  if (name === "Write") return { diff: [{ old: "", new: s(input.content) }] };
  if ((name === "Bash" || name === "PowerShell") && s(input.command).length > 200) return { detail: s(input.command) };
  if (name === "ExitPlanMode" && s(input.plan)) return { detail: s(input.plan, 20000) };
  if ((name === "Task" || name === "Agent") && s(input.prompt)) return { detail: s(input.prompt) };
  return {};
}

/** The JSON object at the end of a plain-text answer (Copilot's): the last ```json block, else the last object that parses. */
export function lastJson(text: string): unknown {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const f of fences.reverse()) {
    try {
      return JSON.parse(f[1]);
    } catch {
      // the next one
    }
  }
  const t = text.slice(-60000);
  const end = t.lastIndexOf("}");
  for (let i = t.lastIndexOf("{", end); i >= 0; i = t.lastIndexOf("{", i - 1)) {
    try {
      return JSON.parse(t.slice(i, end + 1));
    } catch {
      // further back
    }
  }
  return null;
}

/** The plain text a CLI printed (Copilot's answer is in it). */
export function readOutput(id: number): string {
  return read(logPath(id));
}

/** The error output, its last lines. */
export function readErrors(id: number, max = 1500): string {
  const text = read(errPath(id)).trim();
  return text.length > max ? `…${text.slice(-max)}` : text;
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
