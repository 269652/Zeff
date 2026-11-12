/**
 * A plugin's chat kept in a database (manifest `chats[].conversation`): one row per message — yours, the agent's, an exercise shown, the
 * step mastered — written as they happen from the runs' logs (each read up to where it was read before), at the end of each turn, when a run
 * ends and when the chat is looked at. The rows ARE the conversation: what you change or delete there is what the chat shows — and what the
 * agent goes on with. A live session only knows what was said in it, so when the stored conversation changed since the session last spoke
 * (a hash of the rows) the next message starts a fresh session whose prompt carries the conversation from the database. Server only.
 */
import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { extChat, keyOfTodo, type ExtChat } from "@/lib/work/ext-chat";
import { registerConversationGuardFor, type ConversationGuard } from "@/lib/work/conversation-guard";
import { readLog } from "@/lib/work/log";
import { getRun, runsForTodos } from "@/lib/work/store";
import { isActive, type WorkLogLine } from "@/lib/work/shared";
import { getTodo } from "@/lib/todos/store";
import { cellText, type Property, type Row } from "./model";
import { isPackageRef, packagePage } from "./package-refs";
import { addRow, getPage, rawRows } from "./store";

function sql() {
  const d = getSqlite();
  d.exec(`
    create table if not exists chat_msg_sync (run_id integer primary key, todo_id integer not null, lines integer not null default 0, done integer not null default 0);
    create table if not exists chat_conv_state (todo_id integer primary key, hash text, dirty integer not null default 0);
  `);
  return d;
}

/** Who said it, in Zeff's words (the plugin's choice names are mapped: manifest `roles`). `kind`: "message", or a kind its `watch` names. */
export type Role = "you" | "agent" | "system";
export type MsgKind = string;
export type StoredMessage = { id: number; run: number | null; seq: number; role: Role; kind: MsgKind; text: string; at: string };

type Where = { chat: ExtChat; key: string; db: number; p: { text: Property; role: Property; key: Property; kind?: Property; run?: Property; order?: Property; at?: Property } };

/** A chat todo's conversation: the database and its fields, found by name (null: the chat keeps no conversation, or something is not there). */
function whereOf(todoId: number): Where | null {
  const link = keyOfTodo(todoId);
  const chat = link && extChat(link.chat);
  const cfg = chat?.conversation;
  if (!link || !chat || !cfg) return null;
  const db = isPackageRef(cfg.database) ? packagePage(cfg.database) : Number(cfg.database);
  const props = (db && getPage(db)?.schema?.properties) || [];
  const by = (name?: string) => (name ? props.find((x) => x.id === name || x.name.toLowerCase() === name.toLowerCase()) : undefined);
  const text = by(cfg.text);
  const role = by(cfg.role);
  const key = by(cfg.key);
  if (!db || !text || !role || !key) return null;
  return { chat, key: link.key, db, p: { text, role, key, kind: by(cfg.kind), run: by(cfg.run), order: by(cfg.order), at: by(cfg.at) } };
}

const asText = (p: Property | undefined, r: Row): string => (p ? cellText(p, r.cells[p.id]).trim() : "");
const optionId = (p: Property | undefined, name: string): string => p?.options?.find((o) => o.name.toLowerCase() === name.toLowerCase() || o.id === name)?.id ?? name;
const optionName = (p: Property | undefined, v: unknown): string => (p ? cellText(p, v).trim().toLowerCase() : "");

/** A chat's messages (its rows for that key), in the order they were said: by run, then by their order in it. */
export function messagesOf(todoId: number): StoredMessage[] {
  const w = whereOf(todoId);
  if (!w) return [];
  return rawRows(w.db)
    .filter((r) => asText(w.p.key, r) === w.key)
    .map((r): StoredMessage => {
      const named = optionName(w.p.role, r.cells[w.p.role.id]);
      const roles = w.chat.conversation!.roles;
      const role: Role = named === roles.you.toLowerCase() ? "you" : named === roles.agent.toLowerCase() ? "agent" : "system";
      const kind = (w.p.kind && optionName(w.p.kind, r.cells[w.p.kind.id])) || "message";
      const run = w.p.run && typeof r.cells[w.p.run.id] === "number" ? (r.cells[w.p.run.id] as number) : null;
      const seq = w.p.order && typeof r.cells[w.p.order.id] === "number" ? (r.cells[w.p.order.id] as number) : 0;
      return { id: r.id, run, seq, role, kind, text: asText(w.p.text, r) || r.title, at: w.p.at ? asText(w.p.at, r) || r.createdAt : r.createdAt };
    })
    .sort((a, b) => (a.run ?? Number.MAX_SAFE_INTEGER) - (b.run ?? Number.MAX_SAFE_INTEGER) || a.seq - b.seq || a.id - b.id);
}

/** What the stored conversation is now — changed by anything but Zeff's own writing it. */
const hashOf = (todoId: number): string => createHash("sha1").update(JSON.stringify(messagesOf(todoId).map((m) => [m.id, m.role, m.kind, m.text]))).digest("hex");

const titleOf = (role: Role, kind: MsgKind, text: string) => {
  const one = text.replace(/```[\s\S]*?```/g, "▦").replace(/\s+/g, " ").trim();
  const head = kind !== "message" ? `[${kind}] ` : role === "you" ? "› " : "";
  return `${head}${one}`.slice(0, 120) || (role === "agent" ? "…" : "·");
};

function writeMessage(w: Where, v: { run: number | null; seq: number; role: Role; kind: MsgKind; text: string; at: string }): number {
  const cells: Record<string, unknown> = { [w.p.text.id]: v.text.slice(0, 19000), [w.p.role.id]: optionId(w.p.role, w.chat.conversation!.roles[v.role]), [w.p.key.id]: w.key };
  if (w.p.kind) cells[w.p.kind.id] = optionId(w.p.kind, v.kind);
  if (w.p.run && v.run !== null) cells[w.p.run.id] = v.run;
  if (w.p.order) cells[w.p.order.id] = v.seq;
  if (w.p.at) cells[w.p.at.id] = w.p.at.type === "date" ? v.at : v.at.slice(0, 19).replace("T", " ");
  return addRow(w.db, { title: titleOf(v.role, v.kind, v.text), cells });
}

/** A tool call of the agent that is a message of its own (the plugin's function named in `watch`): an exercise made, a step mastered. */
function toolMessage(w: Where, l: WorkLogLine): { role: Role; kind: MsgKind; text: string } | null {
  if (l.k !== "tool" || !/workspace_call_function$/.test(l.tool)) return null;
  const said = `${l.text} ${l.detail ?? ""}`;
  if (!said.includes(w.chat.plugin)) return null;
  for (const watch of w.chat.conversation?.watch ?? []) {
    if (!new RegExp(`["':\\s.]${watch.function}["'\\s,}]`).test(said)) continue;
    const field = watch.field ? new RegExp(`"${watch.field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(said)?.[1] : "";
    return { role: "agent", kind: watch.kind, text: field ?? "" };
  }
  return null;
}

const asMessage = (w: Where, l: WorkLogLine): { role: Role; kind: MsgKind; text: string } | null => {
  if (l.k === "you") return { role: "you", kind: "message", text: l.text };
  if (l.k === "say") return { role: "agent", kind: "message", text: l.text };
  return toolMessage(w, l);
};
const isMessageLine = (w: Where, l: WorkLogLine) => l.k === "you" || l.k === "say" || toolMessage(w, l) !== null;

type SyncState = { lines: number; done: boolean } | null;
const syncState = (runId: number): SyncState => {
  const r = sql().prepare("select lines, done from chat_msg_sync where run_id = ?").get(runId) as { lines: number; done: number } | undefined;
  return r ? { lines: r.lines, done: !!r.done } : null;
};
const convState = (todoId: number) => sql().prepare("select hash, dirty from chat_conv_state where todo_id = ?").get(todoId) as { hash: string | null; dirty: number } | undefined;
const keepState = (todoId: number, hash: string, dirty: boolean) =>
  sql().prepare("insert into chat_conv_state (todo_id, hash, dirty) values (?, ?, ?) on conflict(todo_id) do update set hash = excluded.hash, dirty = excluded.dirty").run(todoId, hash, dirty ? 1 : 0);

/** How far each of a chat's runs has been written into the database (the rest is what is being said right now). */
export function syncStates(runIds: number[]): Map<number, { lines: number; done: boolean }> {
  const out = new Map<number, { lines: number; done: boolean }>();
  for (const id of runIds) {
    const s = syncState(id);
    if (s) out.set(id, s);
  }
  return out;
}

/**
 * A chat's runs written into the database — what they said since they were last read. Before anything is added, the stored conversation is
 * compared with how it was left: changed by someone else (you, in the database) → the chat is marked so its next message starts a fresh
 * session. How many messages were added.
 */
export function syncChat(todoId: number, opts: { spread?: boolean } = {}): number {
  const w = whereOf(todoId);
  if (!w) return 0;
  const todo = getTodo(todoId);
  const runs = [...(runsForTodos([todoId]).get(todoId) ?? [])].reverse(); // oldest first
  const d = sql();
  let added = 0;
  return d.transaction(() => {
    const before = convState(todoId);
    const now = hashOf(todoId);
    const dirty = !!before?.dirty || (!!before?.hash && before.hash !== now);
    for (const run of runs) {
      if (run.status === "queued") continue;
      const st = syncState(run.id);
      if (st?.done) continue;
      const lines = readLog(run.id).lines.filter((l) => isMessageLine(w, l));
      const startedAt = run.startedAt ?? run.queuedAt;
      const endAt = run.finishedAt ?? new Date().toISOString();
      const timeAt = (i: number, n: number) => (opts.spread || !isActive(run.status) ? new Date(Date.parse(startedAt) + ((Date.parse(endAt) - Date.parse(startedAt)) * (i + 1)) / (n + 1)).toISOString() : new Date().toISOString());
      if (!st) {
        // The run's first message(s): what started it (yours - the log does not repeat it).
        const prompts = (todo?.userNotes ?? []).filter((x) => x.kind === "instruction" && x.run === run.id && x.text.trim());
        for (const [seq, n] of prompts.entries()) {
          writeMessage(w, { run: run.id, seq, role: "you", kind: "message", text: n.text.trim(), at: n.at || startedAt });
          added++;
        }
      }
      const from = st?.lines ?? 0;
      for (let i = from; i < lines.length; i++) {
        const m = asMessage(w, lines[i]);
        if (!m) continue;
        writeMessage(w, { run: run.id, seq: 1000 + i, ...m, at: timeAt(i - from, lines.length - from) });
        added++;
      }
      d.prepare("insert into chat_msg_sync (run_id, todo_id, lines, done) values (?, ?, ?, ?) on conflict(run_id) do update set lines = excluded.lines, done = excluded.done").run(run.id, todoId, lines.length, isActive(run.status) ? 0 : 1);
    }
    if (!before && !added && !messagesOf(todoId).length) return 0;
    keepState(todoId, hashOf(todoId), dirty);
    return added;
  })();
}

/** Whether a chat's stored conversation was changed since its session last spoke (its next message starts afresh). */
export function chatChanged(todoId: number): boolean {
  syncChat(todoId);
  return !!convState(todoId)?.dirty;
}

/** The conversation as the database has it now, for a fresh session's prompt (German, as Zeff's prompts) — the newest ~60 000 characters. */
export function conversationPrompt(todoId: number): string {
  const lines = messagesOf(todoId).map((m) => (m.kind !== "message" ? `[${m.kind}${m.text ? `: „${m.text}“` : ""}]` : `${m.role === "you" ? "Person" : m.role === "agent" ? "Du" : "Hinweis"}: ${m.text}`));
  const out: string[] = [];
  let size = 0;
  for (const l of lines.reverse()) {
    if (size + l.length > 60000) break;
    out.unshift(l);
    size += l.length + 2;
  }
  return [
    "Das bisherige Gespräch — so, wie es jetzt in Zeffs Datenbank steht. Die Person hat es dort seit deiner letzten Antwort geändert (Nachrichten bearbeitet oder gelöscht); eine frühere Sitzung von dir kennt es nicht so. Gehe von diesem Stand aus und mach nahtlos weiter.",
    out.length ? out.join("\n\n") : "(Noch nichts gesagt.)",
    "Die neue Nachricht der Person:",
  ].join("\n\n");
}

const guard: ConversationGuard = {
  continuity: (todoId) => (whereOf(todoId) && chatChanged(todoId) ? { fresh: true, context: conversationPrompt(todoId) } : { fresh: false }),
  started: (todoId) => {
    if (whereOf(todoId)) keepState(todoId, hashOf(todoId), false);
  },
  turn: (runId) => {
    const r = getRun(runId);
    if (r) syncChat(r.todoId);
  },
};

/** Every chat of an external plugin that keeps its conversation in a database follows this guard (src/lib/work/conversation-guard.ts). */
registerConversationGuardFor("Zeff-Chat:ext.", () => guard);
