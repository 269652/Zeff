/**
 * A lesson as a timeline (client-safe, pure): what happened, in order — from the conversation's log (the teacher's
 * words, yours, its tool calls) with the exercises (a widget appears where the teacher made it: its learn_widget call)
 * and their results (where their message to the teacher stands — src/plugins/learn/result-message.ts — else after the
 * session they happened in). Left of the line: you — your words, the exercises and how you did; right: the teacher.
 */
import type { WorkLogLine } from "@/lib/work/shared";

export type Answer = { q: string; a: string; ok?: boolean };
export type TimelineResult = { at: string; widget: number; score: number; correct?: number; total?: number; note?: string; answers?: Answer[]; /** The widget as it looked then (store.widgetSnapshot). */ snapshotId?: number };

export type TimelineItem =
  | { side: "center"; kind: "session"; at: string }
  | { side: "center"; kind: "mastered" }
  | { side: "left"; kind: "you"; text: string }
  | { side: "left"; kind: "widget"; widgetId: number; title: string }
  | { side: "left"; kind: "result"; title: string; widgetId: number | null; score: number; correct?: number; total?: number; note?: string; answers?: Answer[]; at: string | null; snapshotId?: number }
  | { side: "right"; kind: "say"; text: string };

/** What of a run's log is the conversation (and goes into the Conversations database): your words, the teacher's, an exercise shown, the step mastered. */
export const isMessageLine = (l: WorkLogLine): boolean => l.k === "you" || l.k === "say" || (l.k === "tool" && /learn_(widget|master_step)$/.test(l.tool));

/** A line of the lesson: from a run's log, or a message of the database (an exercise shown names its widget). */
export type LessonLine = WorkLogLine & { widget?: number | null };

/** A message as the Conversations database keeps it (conversation.ts) — client-safe. */
export type StoredMessage = { run: number | null; role: "you" | "teacher" | "system"; kind: "message" | "exercise" | "mastered"; text: string; exercise: number | null };

/** A stored message as a line of the lesson. */
export const storedLine = (m: StoredMessage): LessonLine =>
  m.kind === "exercise"
    ? { k: "tool", tool: "zeff__learn_widget", text: m.text, widget: m.exercise }
    : m.kind === "mastered"
      ? { k: "tool", tool: "zeff__learn_master_step", text: "" }
      : m.role === "you"
        ? { k: "you", text: m.text }
        : { k: "say", text: m.text };

/**
 * A run's lines for the timeline: what the database has of it (its messages — as you may have changed them), then what its log
 * says beyond what was written there (`synced`: how many of its message lines were) — the turn being written right now.
 */
export const runLines = (stored: StoredMessage[], log: WorkLogLine[], synced: number): LessonLine[] => [...stored.map(storedLine), ...log.filter(isMessageLine).slice(synced)];

/** `prompts`: what started the run (your messages queued for it — each its own; an exercise's result among them too). */
type Run = { id: number; startedAt: string; prompts: string[]; lines: LessonLine[] };
type Widget = { id: number; title: string; createdAt: string };

const RESULT = /^\[Übung „(.+?)“ abgeschlossen: (?:(\d+) von (\d+) richtig, )?(\d+) %/;

export function buildTimeline(v: { runs: Run[]; widgets: Widget[]; results: TimelineResult[] }): TimelineItem[] {
  const out: TimelineItem[] = [];
  const widgets = [...v.widgets].sort((a, b) => a.id - b.id);
  const titleOf = new Map(widgets.map((w) => [w.id, w.title]));
  const results = [...v.results].sort((a, b) => a.at.localeCompare(b.at));
  const usedWidgets = new Set<number>();
  const usedResults = new Set<TimelineResult>();
  const resultItem = (r: TimelineResult): TimelineItem => ({ side: "left", kind: "result", title: titleOf.get(r.widget) ?? "", widgetId: r.widget, score: r.score, correct: r.correct, total: r.total, note: r.note, answers: r.answers, at: r.at, ...(r.snapshotId ? { snapshotId: r.snapshotId } : {}) });
  const runs = [...v.runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  runs.forEach((run, i) => {
    out.push({ side: "center", kind: "session", at: run.startedAt });
    const lines: LessonLine[] = [...run.prompts.filter((x) => x.trim()).map((text): LessonLine => ({ k: "you", text: text.trim() })), ...run.lines];
    for (const l of lines) {
      if (l.k === "say") out.push({ side: "right", kind: "say", text: l.text });
      else if (l.k === "you") {
        const m = RESULT.exec(l.text);
        if (!m) {
          out.push({ side: "left", kind: "you", text: l.text });
          continue;
        }
        // The exercise's message: its recorded result (the first not yet shown, of a widget with that title).
        // (The same exercise done twice: the try whose numbers the message names.)
        const pct = Number(m[4]);
        const same = results.filter((x) => !usedResults.has(x) && titleOf.get(x.widget) === m[1]);
        const r = same.find((x) => Math.round(x.score * 100) === pct && (!m[2] || (x.correct === Number(m[2]) && x.total === Number(m[3])))) ?? same[0];
        if (r) {
          usedResults.add(r);
          out.push(resultItem(r));
        } else out.push({ side: "left", kind: "result", title: m[1], widgetId: null, score: Number(m[4]) / 100, ...(m[2] ? { correct: Number(m[2]), total: Number(m[3]) } : {}), at: null });
      } else if (l.k === "tool" && /learn_widget$/.test(l.tool)) {
        // (A message of the database names its widget; a line of the log: the next one not shown yet.)
        const w = (l.widget ? widgets.find((x) => x.id === l.widget && !usedWidgets.has(x.id)) : undefined) ?? (l.widget === null || l.widget === undefined ? widgets.find((x) => !usedWidgets.has(x.id)) : undefined);
        if (w) {
          usedWidgets.add(w.id);
          out.push({ side: "left", kind: "widget", widgetId: w.id, title: w.title });
        }
      } else if (l.k === "tool" && /learn_master_step$/.test(l.tool)) out.push({ side: "center", kind: "mastered" });
    }
    // Results of this session that sent no message (before the lesson went on by itself): after it.
    const until = runs[i + 1]?.startedAt ?? "￿";
    for (const r of results) {
      if (usedResults.has(r) || r.at >= until) continue;
      usedResults.add(r);
      out.push(resultItem(r));
    }
  });
  // Widgets no call announced (made another way): at the end, to be done.
  for (const w of widgets) if (!usedWidgets.has(w.id)) out.push({ side: "left", kind: "widget", widgetId: w.id, title: w.title });
  for (const r of results) if (!usedResults.has(r)) out.push(resultItem(r));
  return out;
}
