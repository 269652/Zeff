import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emitChange } from "@/lib/events";
import { lives, type Live } from "./live-state";
import { errPath, logPath } from "@/lib/work/log";

/**
 * Interactive workers: Copilot as an Agent Client Protocol server (`copilot --acp`), driven by
 * Zeff over stdio. What it says and does goes into the run's log as it happens; when it wants
 * to do something it isn't allowed yet, it asks — and the question waits on the Work tab (and
 * pings you) till you answer. You can write to it between turns, switch its mode (Agent, Plan,
 * Autopilot), or have it wrap up. A turn that ends with its result (the JSON) ends the run.
 */

const AUTOPILOT = "https://agentclientprotocol.com/protocol/session-modes#autopilot";
const shortMode = (id: string) => id.replace(/^.*#/, "");

type Rpc = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };

const log = (runId: number, text: string) => fs.appendFileSync(/*turbopackIgnore: true*/ logPath(runId), text);

function send(live: Live, msg: Record<string, unknown>) {
  live.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
}

function call<T>(live: Live, method: string, params: Record<string, unknown>): Promise<T> {
  const id = ++live.nextId;
  return new Promise<T>((resolve, reject) => {
    live.pending.set(id, (m) => (m.error ? reject(new Error(m.error.message ?? `${method} failed`)) : resolve(m.result as T)));
    send(live, { id, method, params });
  });
}

/** Its result, if this turn gave one: the last ```json block (or object) in what it said. */
function resultIn(text: string): boolean {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const f of fences.reverse()) {
    try {
      const o = JSON.parse(f[1]) as { outcome?: unknown; summary?: unknown };
      if (o && (typeof o.outcome === "string" || typeof o.summary === "string")) return true;
    } catch {
      // the next one
    }
  }
  return false;
}

/** Something the agent tells or does, into the log (and the page refreshed). */
function onUpdate(live: Live, u: Record<string, unknown>) {
  const kind = u.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const c = u.content as { type?: string; text?: string } | undefined;
    if (c?.type === "text" && c.text) {
      live.turnText += c.text;
      log(live.runId, c.text);
    }
    return;
  }
  if (kind === "tool_call") {
    log(live.runId, `\n▸ ${String(u.title ?? u.kind ?? "Werkzeug")}\n`);
    return;
  }
  if (kind === "tool_call_update" && (u.status === "failed" || u.status === "completed")) {
    if (u.status === "failed") log(live.runId, `  ✗ fehlgeschlagen\n`);
    return;
  }
  if (kind === "plan") {
    const entries = (u.entries as { content?: string; status?: string }[] | undefined) ?? [];
    if (entries.length) log(live.runId, `\n[Plan]\n${entries.map((e) => `  ${e.status === "completed" ? "✓" : e.status === "in_progress" ? "▸" : "·"} ${e.content ?? ""}`).join("\n")}\n`);
    return;
  }
  if (kind === "current_mode_update" && typeof u.currentModeId === "string") {
    live.view.mode = u.currentModeId;
    emitChange("work");
  }
}

/** It asks to do something: the question waits for you (on autopilot it's allowed at once). */
function onPermission(live: Live, rpcId: number | string, p: Record<string, unknown>) {
  const tool = (p.toolCall ?? {}) as { title?: string; kind?: string; rawInput?: unknown };
  const options = ((p.options as { optionId: string; name: string; kind: string }[] | undefined) ?? []).map((o) => ({ id: o.optionId, name: o.name, kind: o.kind }));
  if (shortMode(live.view.mode) === "autopilot") {
    const allow = options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind.startsWith("allow"));
    if (allow) {
      send(live, { id: rpcId, result: { outcome: { outcome: "selected", optionId: allow.id } } });
      return;
    }
  }
  const raw = tool.rawInput && typeof tool.rawInput === "object" ? (tool.rawInput as Record<string, unknown>) : null;
  const detail = raw ? String(raw.command ?? raw.path ?? raw.url ?? JSON.stringify(raw)).slice(0, 600) : null;
  live.permissionRpcId = rpcId;
  live.view.permission = { title: tool.title ?? tool.kind ?? "eine Aktion", detail, options };
  log(live.runId, `\n[Zeff] Copilot fragt um Erlaubnis: ${live.view.permission.title}${detail ? ` — ${detail}` : ""}\n`);
  emitChange("work");
  emitChange("attention");
}

function onLine(live: Live, line: string) {
  let m: Rpc;
  try {
    m = JSON.parse(line) as Rpc;
  } catch {
    return;
  }
  if (m.id !== undefined && !m.method) {
    const done = live.pending.get(Number(m.id));
    live.pending.delete(Number(m.id));
    done?.(m);
    return;
  }
  if (m.method === "session/update") onUpdate(live, (m.params?.update ?? {}) as Record<string, unknown>);
  else if (m.method === "session/request_permission" && m.id !== undefined) onPermission(live, m.id, m.params ?? {});
  else if (m.id !== undefined) send(live, { id: m.id, error: { code: -32601, message: `${m.method} isn't offered by Zeff` } }); // fs/terminal: Copilot uses its own
}

/** One turn: the text sent, then — when it's over — the run ends with its result, or waits for you. */
async function turn(live: Live, text: string) {
  live.view.busy = true;
  live.view.waiting = null;
  live.turnText = "";
  emitChange("work");
  emitChange("attention");
  try {
    const r = await call<{ stopReason?: string }>(live, "session/prompt", { sessionId: live.sessionId, prompt: [{ type: "text", text }] });
    log(live.runId, `\n[Zeff] Zug beendet (${r?.stopReason ?? "?"})\n`);
  } catch (e) {
    log(live.runId, `\n[Zeff] Fehler: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  live.view.busy = false;
  if (resultIn(live.turnText)) {
    await end(live);
    return;
  }
  live.view.waiting = live.turnText.trim().slice(-800) || "Copilot wartet auf dich.";
  emitChange("work");
  emitChange("attention");
}

/** The run taken in (its result from the log), the session closed. */
async function end(live: Live) {
  const { finalize } = await import("@/lib/work/runner");
  await finalize(live.runId);
  close(live);
}

function close(live: Live) {
  lives.delete(live.runId);
  if (!live.child.killed) live.child.kill();
  emitChange("work");
  emitChange("attention");
}

/** Start a live Copilot session for a run: in its folder, its prompt as the first turn. */
export async function startInteractive(v: { runId: number; command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; prompt: string; autopilot: boolean }): Promise<number | null> {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(v.runId)), { recursive: true });
  const child = spawn(/*turbopackIgnore: true*/ v.command, [...v.args, "--acp"], { cwd: v.cwd, env: v.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const live: Live = {
    runId: v.runId,
    child,
    sessionId: "",
    nextId: 0,
    pending: new Map(),
    permissionRpcId: null,
    view: { mode: "", modes: [], busy: true, permission: null, waiting: null },
    turnText: "",
    buf: "",
  };
  lives.set(v.runId, live);
  child.stdout?.on("data", (d) => {
    live.buf += String(d);
    let n: number;
    while ((n = live.buf.indexOf("\n")) >= 0) {
      const line = live.buf.slice(0, n).trim();
      live.buf = live.buf.slice(n + 1);
      if (line) onLine(live, line);
    }
  });
  child.stderr?.on("data", (d) => fs.appendFileSync(/*turbopackIgnore: true*/ errPath(v.runId), String(d)));
  child.on("exit", () => {
    // Gone on its own (a crash, stopped): the run ends with what it has.
    if (lives.get(v.runId) === live) void end(live);
  });
  child.on("error", (e) => fs.appendFileSync(/*turbopackIgnore: true*/ errPath(v.runId), `${e.message}\n`));

  await call(live, "initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  const s = await call<{ sessionId: string; modes?: { currentModeId: string; availableModes: { id: string; name: string }[] } }>(live, "session/new", { cwd: v.cwd, mcpServers: [] });
  live.sessionId = s.sessionId;
  live.view.modes = (s.modes?.availableModes ?? []).map((m) => ({ id: m.id, name: m.name }));
  live.view.mode = s.modes?.currentModeId ?? "";
  if (v.autopilot && live.view.modes.some((m) => m.id === AUTOPILOT)) await setMode(v.runId, AUTOPILOT);
  log(v.runId, `[Zeff] Interaktive Copilot-Sitzung (${live.view.modes.find((m) => m.id === live.view.mode)?.name ?? "Agent"}) — Fragen und Erlaubnisse auf dem Work-Tab.\n`);
  void turn(live, v.prompt);
  return child.pid ?? null;
}

const liveOf = (runId: number) => {
  const live = lives.get(runId);
  if (!live) throw new Error("Die Sitzung läuft nicht (mehr).");
  return live;
};

/** Your answer to what it asked (allow once, always, reject …). */
export function answerPermission(runId: number, optionId: string) {
  const live = liveOf(runId);
  if (live.permissionRpcId === null || !live.view.permission) throw new Error("Es wartet auf keine Erlaubnis.");
  // One of the options it offered — nothing else is passed on.
  const option = live.view.permission.options.find((o) => o.id === optionId);
  if (!option) throw new Error("Not one of the options offered.");
  send(live, { id: live.permissionRpcId, result: { outcome: { outcome: "selected", optionId } } });
  log(runId, `[Du] ${option.name}\n`);
  live.permissionRpcId = null;
  live.view.permission = null;
  emitChange("work");
  emitChange("attention");
}

/** Your message to it (between turns). */
export function sendToLive(runId: number, text: string) {
  const live = liveOf(runId);
  if (live.view.busy) throw new Error("Copilot ist noch dabei — warte, bis es fertig ist (oder halte es an).");
  log(runId, `\n[Du] ${text}\n`);
  void turn(live, text);
}

/** Its mode: Agent (asks), Plan, Autopilot (allows everything) — a waiting permission allowed at once on autopilot. */
export async function setMode(runId: number, modeId: string) {
  const live = liveOf(runId);
  await call(live, "session/set_mode", { sessionId: live.sessionId, modeId });
  live.view.mode = modeId;
  log(runId, `[Zeff] Modus: ${live.view.modes.find((m) => m.id === modeId)?.name ?? shortMode(modeId)}\n`);
  if (shortMode(modeId) === "autopilot" && live.view.permission) {
    const allow = live.view.permission.options.find((o) => o.kind === "allow_once") ?? live.view.permission.options.find((o) => o.kind.startsWith("allow"));
    if (allow) answerPermission(runId, allow.id);
  }
  emitChange("work");
}

/** Wrap up: it's asked for its result now (the JSON) — that ends the run. */
export function wrapUp(runId: number) {
  sendToLive(
    runId,
    "Schließ jetzt ab: fasse zusammen, was du getan hast, und antworte mit dem JSON-Ergebnis im verlangten Format (```json-Block) — outcome, summary, entry, completedTodos, followUps.",
  );
}

/** Stop it now (its turn cancelled, the session closed) — the run ends with what it has. */
export async function stopLive(runId: number) {
  const live = lives.get(runId);
  if (!live) return;
  send(live, { method: "session/cancel", params: { sessionId: live.sessionId } });
  await end(live);
}
