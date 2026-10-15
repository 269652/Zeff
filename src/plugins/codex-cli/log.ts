import fs from "node:fs";
import path from "node:path";
import { accountDir, currentAccountId } from "@/db/accounts";
import { t } from "@/lib/i18n/server";
import type { WorkLogLine } from "@/lib/work/shared";

/**
 * A Codex run's log as the Code tab shows it — the same lines as Claude's (lib/work/log.ts
 * readLog), from what `codex app-server` printed (JSON-RPC, a line each) and what Zeff sent it
 * (beside the log). readLog hands a run over here when its log starts with the Codex marker.
 */

// The run's files, laid out as lib/work/log.ts lays them out (not imported from there: it imports this).
const logsDir = () => path.join(accountDir(currentAccountId()), "work", "logs");
const logFile = (id: number) => path.join(logsDir(), `${id}.jsonl`);
const inFile = (id: number) => path.join(logsDir(), `${id}.in.jsonl`);
const errFile = (id: number) => path.join(logsDir(), `${id}.err`);

/** The log's first line for a Codex run (live or not): readLog reads it with readCodexLog. */
export const CODEX_MARKER = `{"zeff":"codex"}`;

/** Mark a run's log as Codex's — before anything else is written to it. */
export function markCodexRun(id: number): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ logsDir(), { recursive: true });
  let size = 0;
  try {
    size = fs.statSync(/*turbopackIgnore: true*/ logFile(id)).size;
  } catch {
    // none yet
  }
  if (!size) fs.writeFileSync(/*turbopackIgnore: true*/ logFile(id), `${CODEX_MARKER}\n`);
}

/** This run's log is a Codex one (its first line). */
export function isCodexRun(id: number): boolean {
  let fd: number;
  try {
    fd = fs.openSync(/*turbopackIgnore: true*/ logFile(id), "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(CODEX_MARKER.length);
    return fs.readSync(fd, buf, 0, buf.length, 0) === buf.length && buf.toString("utf8") === CODEX_MARKER;
  } finally {
    fs.closeSync(fd);
  }
}

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

type Rpc = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } };
type Item = { type?: string; id?: string; text?: string; command?: string; commandActions?: { command?: string }[]; aggregatedOutput?: string | null; exitCode?: number | null; status?: string; changes?: FileUpdate[]; server?: string; tool?: string; arguments?: unknown; error?: { message?: string } | null; content?: { type?: string; text?: string }[]; query?: string };
export type FileUpdate = { path: string; kind?: { type?: string }; diff?: string };

/** A command as the agent meant it (Codex wraps it in a shell: its parsed actions say what runs). */
export function commandText(command: string | null | undefined, actions: { command?: string }[] | null | undefined): string {
  const parts = (actions ?? []).map((a) => a.command ?? "").filter(Boolean);
  return parts.length ? parts.join(" && ") : (command ?? "");
}

/** A unified diff's hunks as old and new text (an added file's diff may be its content as is). */
export function diffHunks(diff: string): { old: string; new: string }[] {
  if (!/^@@/m.test(diff)) return [{ old: "", new: diff }];
  const hunks: { old: string[]; new: string[] }[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) hunks.push({ old: [], new: [] });
    else if (!hunks.length || !line || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("\\")) continue;
    else if (line.startsWith("-")) hunks[hunks.length - 1].old.push(line.slice(1));
    else if (line.startsWith("+")) hunks[hunks.length - 1].new.push(line.slice(1));
    else {
      hunks[hunks.length - 1].old.push(line.slice(1));
      hunks[hunks.length - 1].new.push(line.slice(1));
    }
  }
  return hunks.map((h) => ({ old: h.old.join("\n"), new: h.new.join("\n") }));
}

/** A file change as Claude's tools show it: Write (a new file), Edit/MultiEdit (one changed file), else Write with the diffs. */
export function fileChangeInput(changes: FileUpdate[]): { tool: string; input: Record<string, unknown> } {
  if (changes.length === 1) {
    const c = changes[0];
    const diff = c.diff ?? "";
    if (c.kind?.type === "add") return { tool: "Write", input: { file_path: c.path, content: diffHunks(diff).map((h) => h.new).join("\n") } };
    if (c.kind?.type === "update") {
      const hunks = diffHunks(diff);
      if (hunks.length === 1) return { tool: "Edit", input: { file_path: c.path, old_string: hunks[0].old, new_string: hunks[0].new } };
      return { tool: "MultiEdit", input: { file_path: c.path, edits: hunks.map((h) => ({ old_string: h.old, new_string: h.new })) } };
    }
  }
  return { tool: "Write", input: { file_path: changes.map((c) => c.path).join(", "), content: changes.map((c) => `${c.kind?.type === "delete" ? "deleted: " : ""}${c.path}\n${c.diff ?? ""}`).join("\n\n") } };
}

/** Your answer to what it asked, in a few words (as readLog says Claude's). */
function answerText(method: string, res: Record<string, unknown> | undefined, questions: Map<string, string>): { answer: string; ok: boolean } | Record<string, never> {
  if (!res) return {};
  if (method === "item/tool/requestUserInput") {
    const answers = Object.entries((res.answers ?? {}) as Record<string, { answers?: string[] }>).filter(([, a]) => a?.answers?.length);
    if (!answers.length) return { ok: false, answer: t("denied") };
    return { ok: true, answer: answers.map(([id, a]) => `${short(questions.get(id) ?? id, 80)} → ${(a.answers ?? []).join(", ")}`).join(" · ") };
  }
  if (method === "item/permissions/requestApproval") {
    const granted = Object.keys((res.permissions ?? {}) as object).length > 0;
    return granted ? { ok: true, answer: res.scope === "session" ? t("allowed — always") : t("allowed") } : { ok: false, answer: t("denied") };
  }
  if (method === "mcpServer/elicitation/request") return res.action === "accept" ? { ok: true, answer: t("allowed") } : { ok: false, answer: `${t("denied")}${res.action === "cancel" ? ` — ${t("and stopped")}` : ""}` };
  const d = res.decision;
  if (d === "accept") return { ok: true, answer: t("allowed") };
  if (d === "acceptForSession" || (d && typeof d === "object")) return { ok: true, answer: t("allowed — always") };
  return { ok: false, answer: `${t("denied")}${d === "cancel" ? ` — ${t("and stopped")}` : ""}` };
}

/** What it asked, in a few words. */
function askText(m: Rpc, files: Map<string, FileUpdate[]>, questions: Map<string, string>): string | null {
  const p = m.params ?? {};
  switch (m.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return `Bash: ${short(commandText(p.command as string, p.commandActions as { command?: string }[]), 220)}`;
    case "item/fileChange/requestApproval":
    case "applyPatchApproval": {
      const changes = files.get(String(p.itemId)) ?? [];
      return `${fileChangeInput(changes).tool}: ${changes.map((c) => c.path).join(", ") || short(String(p.reason ?? ""), 200)}`;
    }
    case "item/tool/requestUserInput": {
      const qs = (p.questions ?? []) as { id: string; question: string }[];
      for (const q of qs) questions.set(q.id, q.question);
      return t("Asks: {q}", { q: qs.map((q) => q.question).join(" · ") });
    }
    case "item/permissions/requestApproval":
      return `Permissions: ${short(String(p.reason ?? JSON.stringify(p.permissions ?? {})), 200)}`;
    case "mcpServer/elicitation/request":
      return `MCP ${String(p.serverName ?? "")}: ${short(String(p.message ?? p.url ?? ""), 200)}`;
    default:
      return null;
  }
}

/**
 * Codex's log condensed, as readLog condenses Claude's: your messages (the first is the prompt,
 * shown as the question), its words, its commands and their output's end, its file changes, what
 * it asked and what you answered, each turn's end; errors and the error output's last lines.
 */
export function readCodexLog(id: number): { lines: WorkLogLine[]; errors: string[]; result: null; sessionId: string | null; cwd: string | null } {
  const raw = read(logFile(id));
  const whole = raw.endsWith("\n") ? raw : raw.slice(0, raw.lastIndexOf("\n") + 1);
  // What Zeff sent: its requests (by id, to know what a response answers) and its answers to the CLI's requests.
  const sent = new Map<string, string>();
  const answers = new Map<string, Record<string, unknown>>();
  for (const line of read(inFile(id)).split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const m = (JSON.parse(line) as { msg?: Rpc }).msg;
      if (m?.id === undefined) continue;
      if (m.method) sent.set(String(m.id), m.method);
      else if (m.result) answers.set(String(m.id), m.result);
    } catch {
      // half written
    }
  }
  const lines: WorkLogLine[] = [];
  const files = new Map<string, FileUpdate[]>();
  const questions = new Map<string, string>();
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let promptSeen = false;
  for (const line of whole.split("\n")) {
    if (!line.trim() || line === CODEX_MARKER) continue;
    let m: Rpc & { type?: string; event?: string; elevated?: boolean; code?: number | null };
    try {
      m = JSON.parse(line) as typeof m;
    } catch {
      lines.push({ k: "raw", text: line.replace(ANSI, "") });
      continue;
    }
    if (m.type === "zeff_host") {
      if (m.event === "start") lines.push({ k: "note", text: t("Session started") });
      else if (m.event === "exit") lines.push({ k: "note", text: m.code ? t("Session process ended (exit {code})", { code: m.code }) : t("Session process ended") });
      continue;
    }
    const p = m.params ?? {};
    if (m.method && m.id !== undefined) {
      // It asks (a command, a file change, a question …): with your answer, once given.
      const text = askText(m, files, questions);
      if (text) lines.push({ k: "ask", text, ...answerText(m.method, answers.get(String(m.id)), questions) });
      continue;
    }
    if (!m.method && m.id !== undefined) {
      // A response to Zeff: the thread (its model, folder, permissions), or a request it refused.
      const method = sent.get(String(m.id));
      const r = m.result ?? {};
      if ((method === "thread/start" || method === "thread/resume") && m.result) {
        const thread = (r.thread ?? {}) as { id?: string; cwd?: string };
        sessionId = thread.id ?? sessionId;
        cwd = (r.cwd as string) ?? thread.cwd ?? cwd;
        const sandbox = (r.sandbox as { type?: string } | undefined)?.type;
        const mode = [typeof r.approvalPolicy === "string" ? r.approvalPolicy : "", sandbox].filter(Boolean).join(", ");
        lines.push({ k: "start", model: r.model as string, text: [r.model, cwd, mode && t("permissions: {mode}", { mode })].filter(Boolean).join(" · ") });
      } else if (m.error && method !== "turn/steer") lines.push({ k: "out", error: true, text: short(`${method ?? "?"}: ${m.error.message ?? ""}`, 400) });
      continue;
    }
    const item = (p.item ?? {}) as Item;
    switch (m.method) {
      case "thread/started":
        sessionId ??= ((p.thread ?? {}) as { id?: string }).id ?? null;
        break;
      case "item/started":
        if (item.type === "commandExecution") {
          const command = commandText(item.command, item.commandActions);
          lines.push({ k: "tool", tool: "Bash", text: short(command, 220), ...(command.length > 200 ? { detail: command.slice(0, 8000) } : {}) });
        } else if (item.type === "fileChange" && item.id) {
          files.set(item.id, item.changes ?? []);
          const changes = item.changes ?? [];
          lines.push({ k: "tool", tool: changes.some((c) => c.kind?.type === "update") ? "Edit" : "Write", text: changes.map((c) => c.path).join(", "), diff: changes.flatMap((c) => diffHunks(c.diff ?? "")).slice(0, 20).map((h) => ({ old: h.old.slice(0, 8000), new: h.new.slice(0, 8000) })) });
        }
        break;
      case "item/completed":
        if (item.type === "userMessage") {
          // Your message as it took it in: the first is the prompt itself.
          const text = (item.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("").trim();
          const images = (item.content ?? []).filter((c) => c.type === "image" || c.type === "localImage").length;
          if (text.startsWith("Schließ jetzt ab:")) lines.push({ k: "note", text: t("You asked it to finish — its result ends the session") });
          else if (promptSeen && (text || images)) lines.push({ k: "you", text: text.slice(0, 20000), ...(images ? { images } : {}) });
          promptSeen = true;
        } else if (item.type === "agentMessage" && item.text?.trim()) lines.push({ k: "say", text: item.text.trim() });
        else if (item.type === "commandExecution") {
          const out = (item.aggregatedOutput ?? "").replace(ANSI, "");
          const failed = item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0;
          const full = out.length > 300 || out.split("\n").length > 3 ? out.slice(-20000) : undefined;
          if (failed) lines.push({ k: "out", error: true, text: short(out || item.status || "", 400), ...(full ? { full } : {}) });
          else if (out.trim()) lines.push({ k: "out", text: tail(out, 3, 300), ...(full ? { full } : {}) });
        } else if (item.type === "fileChange" && (item.status === "failed" || item.status === "declined")) lines.push({ k: "out", error: true, text: item.status });
        else if (item.type === "mcpToolCall") {
          lines.push({ k: "tool", tool: `${item.server ?? "?"}__${item.tool ?? "?"}`, text: short(JSON.stringify(item.arguments ?? {}), 200) });
          if (item.error?.message) lines.push({ k: "out", error: true, text: short(item.error.message, 400) });
        } else if (item.type === "webSearch") lines.push({ k: "tool", tool: "WebSearch", text: short(item.query ?? "", 200) });
        break;
      case "error": {
        const e = (p.error ?? {}) as { message?: string };
        if (p.willRetry) lines.push({ k: "note", text: short(e.message ?? "", 300) });
        break;
      }
      case "turn/completed": {
        const turn = (p.turn ?? {}) as { status?: string; error?: { message?: string } | null };
        if (turn.status === "interrupted") lines.push({ k: "note", text: t("Turn stopped") });
        else if (turn.status === "failed") lines.push({ k: "end", ok: false, text: t("Turn ended ({reason})", { reason: short(turn.error?.message ?? "error", 300) }) });
        else lines.push({ k: "note", text: t("Turn done") });
        break;
      }
    }
  }
  const errors = read(errFile(id))
    .split("\n")
    .map((l) => l.replace(ANSI, "").trimEnd())
    .filter((l) => l.trim())
    .slice(-20);
  return { lines, errors, result: null, sessionId, cwd };
}
