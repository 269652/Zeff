/**
 * A lesson's conversation in the Conversations database: one row per message (yours, the teacher's, an exercise shown, the
 * step mastered) — written as they happen, from each of the lesson's runs (its log, read up to where it was read before:
 * learn_msg_sync), at the end of each of the teacher's turns, when a run ends and when the lesson is looked at. The rows are
 * the conversation: what you change or delete there is what the lesson shows — and what the teacher goes on with. Its live
 * Claude session only knows what was said in it, so when the stored conversation changed since the session's last turn
 * (a hash of the rows: learn_lessons) the next message starts a fresh session whose prompt carries the conversation from the
 * database; otherwise the session is resumed as always. Server only.
 */
import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { getTodo } from "@/lib/todos/store";
import { readLog } from "@/lib/work/log";
import { getRun, runsForTodos } from "@/lib/work/store";
import { isActive, type WorkLogLine } from "@/lib/work/shared";
import { addRow, getPage, updatePage } from "@/plugins/workspace/store";
import type { Row } from "@/plugins/workspace/model";
import { dbsFor, learnRows, memo, P } from "./dbs";
import { getNode, lessonOfTodo, nodeWidgets, timeCell, cellTime } from "./store";
import { isMessageLine } from "./timeline";

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists learn_msg_sync (run_id integer primary key, todo_id integer not null, lines integer not null default 0, done integer not null default 0);
    create table if not exists learn_lessons (todo_id integer primary key, hash text, dirty integer not null default 0);
  `);
  return d;
}

export type Role = "you" | "teacher" | "system";
export type MsgKind = "message" | "exercise" | "mastered";
export type LessonMessage = { id: number; run: number | null; seq: number; role: Role; kind: MsgKind; text: string; at: string; exercise: number | null };

/** The most a message's text cell holds — a longer one is kept whole on its row's page. */
const CELL = 19000;
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const ids = (v: unknown): number[] => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

function fullText(r: Row): string {
  const cell = str(r.cells[P.text]);
  if (cell.length < CELL) return cell;
  const doc = getPage(r.id)?.content as { content?: { type: string; content?: { text?: string }[] }[] } | undefined;
  const block = doc?.content?.find((n) => n.type === "codeBlock");
  const whole = (block?.content ?? []).map((t) => t.text ?? "").join("");
  return whole || cell;
}

/** A step's messages (its row), in the order they were said: by session, then by their order in it. */
export function stepMessages(stepRowId: number): LessonMessage[] {
  return memo(`learn:msgs:${stepRowId}`, () =>
    learnRows("messages")
      .filter((r) => ids(r.cells[P.step]).includes(stepRowId))
      .map((r): LessonMessage => {
        const c = r.cells;
        const role = (["you", "teacher", "system"] as const).find((x) => x === c[P.role]) ?? "system";
        const kind = (["message", "exercise", "mastered"] as const).find((x) => x === c[P.msgKind]) ?? "message";
        return { id: r.id, run: c[P.run] === undefined || c[P.run] === null ? null : Number(c[P.run]), seq: Number(c[P.seq] ?? 0), role, kind, text: fullText(r), at: cellTime(c[P.at]) ?? r.createdAt, exercise: ids(c[P.exercise])[0] ?? null };
      })
      .sort((a, b) => (a.run ?? Number.MAX_SAFE_INTEGER) - (b.run ?? Number.MAX_SAFE_INTEGER) || a.seq - b.seq || a.id - b.id),
  );
}

/** What the stored conversation is now (its rows and what they say) — changed by anything but Zeff's own writing it. */
export function conversationHash(stepRowId: number): string {
  return createHash("sha1")
    .update(JSON.stringify(stepMessages(stepRowId).map((m) => [m.id, m.role, m.kind, m.text, m.exercise])))
    .digest("hex");
}

const titleOf = (role: Role, kind: MsgKind, text: string) => {
  const one = text.replace(/```[\s\S]*?```/g, "▦").replace(/\s+/g, " ").trim();
  const head = kind === "exercise" ? "🧩 " : kind === "mastered" ? "✓ " : role === "you" ? "› " : "";
  return `${head}${one}`.slice(0, 120) || (role === "teacher" ? "…" : "·");
};

/** A message written into Conversations (a long one kept whole on its row's page). */
function writeMessage(v: { courseId: number; stepRowId: number; run: number | null; seq: number; role: Role; kind: MsgKind; text: string; at: string; exercise?: number | null }): number {
  const long = v.text.length >= CELL;
  const id = addRow(dbsFor(v.courseId).messages, {
    title: titleOf(v.role, v.kind, v.text),
    cells: {
      [P.role]: v.role,
      [P.msgKind]: v.kind,
      [P.text]: long ? `${v.text.slice(0, CELL)}…` : v.text || undefined,
      [P.at]: timeCell(v.at),
      [P.course]: [v.courseId],
      [P.step]: [v.stepRowId],
      ...(v.run !== null ? { [P.run]: v.run } : {}),
      [P.seq]: v.seq,
      ...(v.exercise ? { [P.exercise]: [v.exercise] } : {}),
    },
  });
  if (long) updatePage(id, { content: { type: "doc", content: [{ type: "codeBlock", attrs: { language: "markdown" }, content: chunks(v.text) }] } });
  return id;
}
const chunks = (s: string) => {
  const out: { type: "text"; text: string }[] = [];
  for (let i = 0; i < s.length; i += 100000) out.push({ type: "text", text: s.slice(i, i + 100000) });
  return out;
};

/** A log line as a message. */
function asMessage(l: WorkLogLine): { role: Role; kind: MsgKind; text: string } | null {
  if (l.k === "you") return { role: "you", kind: "message", text: l.text };
  if (l.k === "say") return { role: "teacher", kind: "message", text: l.text };
  if (l.k === "tool" && /learn_widget$/.test(l.tool)) return { role: "teacher", kind: "exercise", text: "" };
  if (l.k === "tool" && /learn_master_step$/.test(l.tool)) return { role: "system", kind: "mastered", text: "" };
  return null;
}

type SyncState = { lines: number; done: boolean } | null;
const syncState = (runId: number): SyncState => {
  const r = db().prepare("select lines, done from learn_msg_sync where run_id = ?").get(runId) as { lines: number; done: number } | undefined;
  return r ? { lines: r.lines, done: !!r.done } : null;
};

/** How far each of a lesson's runs has been written into the database (the timeline shows the rest from the log). */
export function syncStates(runIds: number[]): Map<number, { lines: number; done: boolean }> {
  const out = new Map<number, { lines: number; done: boolean }>();
  for (const id of runIds) {
    const s = syncState(id);
    if (s) out.set(id, s);
  }
  return out;
}

const lessonState = (todoId: number) => db().prepare("select hash, dirty from learn_lessons where todo_id = ?").get(todoId) as { hash: string | null; dirty: number } | undefined;
const keepState = (todoId: number, hash: string, dirty: boolean) =>
  db().prepare("insert into learn_lessons (todo_id, hash, dirty) values (?, ?, ?) on conflict(todo_id) do update set hash = excluded.hash, dirty = excluded.dirty").run(todoId, hash, dirty ? 1 : 0);

/**
 * A lesson's runs written into Conversations — what they said since they were last read (a run waiting in the queue: not
 * yet). Before anything is added, the stored conversation is compared with how it was left: changed by someone else (you, in
 * the database) → the lesson is marked so its next message starts a fresh session. `spread`: times spread over a past run
 * (when it was read in afterwards) instead of now. How many messages were added.
 */
export function syncLesson(todoId: number, opts: { spread?: boolean } = {}): number {
  const lesson = lessonOfTodo(todoId);
  if (!lesson) return 0;
  const node = getNode(lesson.courseId, lesson.key);
  if (!node) return 0;
  const runs = [...(runsForTodos([todoId]).get(todoId) ?? [])].reverse(); // oldest first
  const d = db();
  let added = 0;
  const todo = getTodo(todoId);
  return d.transaction(() => {
    const before = lessonState(todoId);
    const now = conversationHash(node.id);
    const dirty = !!before?.dirty || (!!before?.hash && before.hash !== now);
    // (The exercises shown so far in this lesson: the next learn_widget call is the next of the step's widgets.)
    let shown = stepMessages(node.id).filter((m) => m.kind === "exercise").length;
    const widgets = nodeWidgets(lesson.courseId, lesson.key, { html: false });
    for (const run of runs) {
      if (run.status === "queued") continue;
      const st = syncState(run.id);
      if (st?.done) continue;
      const lines = readLog(run.id).lines.filter(isMessageLine);
      const startedAt = run.startedAt ?? run.queuedAt;
      const endAt = run.finishedAt ?? new Date().toISOString();
      const timeAt = (i: number, n: number) => (opts.spread || !isActive(run.status) ? new Date(Date.parse(startedAt) + ((Date.parse(endAt) - Date.parse(startedAt)) * (i + 1)) / (n + 1)).toISOString() : new Date().toISOString());
      if (!st) {
        // The run's first message(s): what started it (yours — the log doesn't repeat it).
        const prompts = (todo?.userNotes ?? []).filter((x) => x.kind === "instruction" && x.run === run.id && x.text.trim());
        for (const [seq, n] of prompts.entries()) {
          writeMessage({ courseId: lesson.courseId, stepRowId: node.id, run: run.id, seq, role: "you", kind: "message", text: n.text.trim(), at: n.at || startedAt });
          added++;
        }
      }
      const from = st?.lines ?? 0;
      for (let i = from; i < lines.length; i++) {
        const m = asMessage(lines[i]);
        if (!m) continue;
        const exercise = m.kind === "exercise" ? (widgets[shown++]?.id ?? null) : null;
        if (m.kind === "exercise" && exercise) m.text = widgets.find((w) => w.id === exercise)?.title ?? "";
        writeMessage({ courseId: lesson.courseId, stepRowId: node.id, run: run.id, seq: 1000 + i, role: m.role, kind: m.kind, text: m.text, at: timeAt(i - from, lines.length - from), exercise });
        added++;
      }
      d.prepare("insert into learn_msg_sync (run_id, todo_id, lines, done) values (?, ?, ?, ?) on conflict(run_id) do update set lines = excluded.lines, done = excluded.done").run(run.id, todoId, lines.length, isActive(run.status) ? 0 : 1);
    }
    if (!before && !added && !stepMessages(node.id).length) return 0;
    keepState(todoId, conversationHash(node.id), dirty);
    return added;
  })();
}

/** A run's lesson brought up to date (a turn ended, a run finished) — nothing when it isn't a lesson's. */
export function syncRun(runId: number): number {
  const r = getRun(runId);
  return r ? syncLesson(r.todoId) : 0;
}

/** Whether a lesson's stored conversation was changed since its session last spoke (its next message starts afresh). */
export function lessonChanged(todoId: number): boolean {
  syncLesson(todoId);
  return !!lessonState(todoId)?.dirty;
}

/** The conversation as the database has it now, for a fresh session's prompt (German, as the teacher's rules) — the newest ~60 000 characters. */
export function conversationPrompt(todoId: number): string {
  const lesson = lessonOfTodo(todoId);
  const node = lesson && getNode(lesson.courseId, lesson.key);
  if (!node) return "";
  const lines = stepMessages(node.id).map((m) =>
    m.kind === "exercise" ? `[Übung gezeigt: „${m.text}“${m.exercise ? ` (Widget #${m.exercise})` : ""}]` : m.kind === "mastered" ? "[Einheit als gemeistert markiert]" : `${m.role === "you" ? "Person" : m.role === "teacher" ? "Du (Lehrer)" : "Zeff"}: ${m.text}`,
  );
  const out: string[] = [];
  let size = 0;
  for (const l of lines.reverse()) {
    if (size + l.length > 60000) break;
    out.unshift(l);
    size += l.length + 2;
  }
  return [
    "Das bisherige Gespräch dieser Lerneinheit — so, wie es jetzt in Zeffs Datenbank steht. Die Person hat es dort seit deiner letzten Antwort geändert (Nachrichten bearbeitet oder gelöscht); eine frühere Sitzung gilt nicht mehr, nur dieser Stand. Mach von hier aus weiter, ohne das Gespräch zu wiederholen.",
    out.length ? out.join("\n\n") : "(Noch nichts gesagt.)",
    "Die neue Nachricht der Person:",
  ].join("\n\n");
}

/** A fresh session began with the conversation from the database: the lesson is as the session knows it. */
export function freshSessionStarted(todoId: number): void {
  const lesson = lessonOfTodo(todoId);
  const node = lesson && getNode(lesson.courseId, lesson.key);
  if (node) keepState(todoId, conversationHash(node.id), false);
}

/** The lesson's guard (src/lib/work/conversation-guard.ts): resume its session, or start afresh with the stored conversation. */
export function lessonContinuity(todoId: number): { fresh: false } | { fresh: true; context: string } {
  if (!lessonOfTodo(todoId)) return { fresh: false };
  if (!lessonChanged(todoId)) return { fresh: false };
  return { fresh: true, context: conversationPrompt(todoId) };
}
