import { and, eq, gt, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { cleanOps, cleanPlan, dueDay, isTodoKind, todoRef, type TodoOp, type TodoPath, type TodoUserNote } from "./shared";
import { sameCase, sameOp, similarText, wordOverlap } from "./similar";

const { todos, todoEvents, workRuns, todoTime, todoLinks, entrySuggestions, calendarEvents } = schema;

const parse = <T>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** What a todo that repeats another brings to it: the new one's content, and where it came from (for the history). */
export type MergeCandidate = {
  ticket: string;
  text: string;
  kind?: string;
  ops?: unknown[];
  refs?: string[];
  mailRefs?: string[];
  due?: string | null;
  draft?: string | null;
  channel?: string | null;
  target?: string | null;
  planned?: TodoPath[];
  userNotes?: TodoUserNote[];
  knowledge?: string | null;
  flaggedAt?: string | null;
  needsInput?: string | null;
  runId?: number | null;
  workRunId?: number | null;
  /** When it was found, where its sources have no date of their own (default: now): it is the newer of the two when what it rests on is — then, about the same case (Aktenzeichen), its text, deadline and operations replace the older's (which stays as a note). */
  at?: string;
  /** Where it came from, in words ("Mail-Durchsicht", "Follow-up from W-45", "T-12 (merged)") - the history's note. */
  from: string;
  /** Who made it: "lage:3", "work:45", "you", "agent:x" - none: whoever `attributed()` says. */
  actor?: string | null;
};

/** When the information of a todo is from: the latest date of what it rests on (the mail's, the document's — the letter's arrival), else `fallback`. */
export function infoAt(refs: string[], fallback: string): string {
  const db = getDb();
  const dates: string[] = [];
  for (const r of refs) {
    if (r.startsWith("mail:")) {
      const m = db.select({ at: schema.emails.receivedAt }).from(schema.emails).where(eq(schema.emails.key, r.slice(5))).get();
      if (m?.at) dates.push(m.at);
    } else if (/^doc:\d+$/.test(r)) {
      const id = Number(r.slice(4));
      const d = db.select({ at: schema.documents.createdAt }).from(schema.documents).where(eq(schema.documents.id, id)).get();
      const att = db.select({ key: schema.mailAttachments.mailKey }).from(schema.mailAttachments).where(eq(schema.mailAttachments.docId, id)).get();
      const mail = att && db.select({ at: schema.emails.receivedAt }).from(schema.emails).where(eq(schema.emails.key, att.key)).get();
      if (mail?.at) dates.push(mail.at);
      else if (d?.at) dates.push(d.at);
    }
  }
  return dates.sort().at(-1) ?? fallback;
}

const union = (a: string[], b: string[] = [], cap = 40) => [...new Set([...a, ...b])].slice(-cap);

/**
 * A todo takes in what a repeat of it brings, and is touched: it counts as new to you again
 * (updated, `merged_at`, un-deferred), and its history gets a "merged" record saying what came
 * and from where. The oldest todo keeps its id, its text, its owner - the repeat only adds. False: it isn't open.
 */
export function absorb(survivorId: number, c: MergeCandidate): boolean {
  const db = getDb();
  const row = db.select().from(todos).where(eq(todos.id, survivorId)).get();
  if (!row || row.status !== "open") return false;
  const now = new Date().toISOString();
  const ticket = row.ticket;
  const refs = union(parse<string[]>(row.refs, []), c.refs);
  const mailRefs = union(parse<string[]>(row.mailRefs, []), c.mailRefs);
  // Operations: the oldest's stay; the new ones only where it doesn't do that already (same action, same message to the same one).
  const had = cleanOps(parse<unknown[]>(row.ops, []), ticket);
  // The newer information about the same case replaces what the older said.
  const survivorAt = infoAt([...parse<string[]>(row.refs, []), ...parse<string[]>(row.mailRefs, [])], row.createdAt);
  const newer = infoAt([...(c.refs ?? []), ...(c.mailRefs ?? [])], c.at ?? now) >= survivorAt;
  const replaces = newer && !!c.text.trim() && sameCase(c.text, row.text) && c.text.trim() !== row.text.trim();
  const newOps = cleanOps(c.ops, ticket);
  const ops: TodoOp[] = replaces && newOps.length ? [] : [...had];
  for (const o of newOps) if (!ops.some((x) => sameOp(x, o))) ops.push(o);
  // The earlier deadline wins — but the newer information about a case brings its own.
  const due = replaces && dueDay(c.due) ? dueDay(c.due) : ([row.due, dueDay(c.due)].filter((d): d is string => !!d).sort()[0] ?? null);
  // Its plan takes the steps it doesn't plan already.
  let planned = cleanPlan(parse<unknown[]>(row.planned, []), ticket);
  const fresh = (c.planned ?? []).flatMap((p) => p.steps).filter((s) => !planned.flatMap((p) => p.steps).some((h) => similarText(h.text, s.text)));
  if (fresh.length) planned = planned.length ? [{ ...planned[0], steps: [...planned[0].steps, ...fresh].slice(0, 7) }, ...planned.slice(1)] : [{ path: null, steps: fresh.slice(0, 7) }];
  // Notes: the repeat's own, and its wording - when it adds something to the text it repeats.
  const notes = parse<TodoUserNote[]>(row.userNotes, []);
  for (const n of c.userNotes ?? []) if (!notes.some((x) => x.text === n.text)) notes.push(n);
  const text = c.text.trim();
  if (replaces) notes.push({ at: now, text: `Replaced by newer information: ${row.text}`.slice(0, 600), by: "Zeff" });
  else if (text && wordOverlap(text, row.text) < 0.85 && !notes.some((x) => x.text.includes(text.slice(0, 120)))) notes.push({ at: now, text: `Merged duplicate: ${text}`.slice(0, 600), by: "Zeff" });
  const noDraft = !row.draft?.trim();
  db.update(todos)
    .set({
      ...(replaces ? { text } : {}),
      refs: JSON.stringify(refs),
      mailRefs: JSON.stringify(mailRefs),
      ops: JSON.stringify(ops),
      due,
      planned: JSON.stringify(planned),
      userNotes: JSON.stringify(notes),
      // A placeholder kind gives way to a real one; the owner, text and source stay the oldest's.
      ...(row.kind === "other" && isTodoKind(c.kind) && c.kind !== "other" ? { kind: c.kind } : {}),
      ...(noDraft && c.draft?.trim() ? { draft: c.draft.trim().slice(0, 8000), channel: c.channel === "jira" || c.channel === "teams" || c.channel === "gitlab" ? c.channel : row.channel, target: c.target?.trim() || row.target } : {}),
      ...(!row.knowledge && c.knowledge ? { knowledge: c.knowledge } : {}),
      ...(!row.flaggedAt && c.flaggedAt ? { flaggedAt: c.flaggedAt } : {}),
      ...(!row.needsInput && c.needsInput ? { needsInput: c.needsInput } : {}),
      ...(c.runId ? { runId: c.runId } : {}),
      // New on it: it comes back up, and the auto-actions review looks at it again.
      deferredAt: null,
      actionsReviewedAt: null,
      updatedAt: now,
      mergedAt: now,
    })
    .where(eq(todos.id, survivorId))
    .run();
  db.insert(todoEvents)
    .values({
      todoId: survivorId,
      event: "merged",
      ticket,
      text: text.slice(0, 200),
      note: c.from.slice(0, 500),
      actor: c.actor ?? (c.workRunId ? `work:${c.workRunId}` : c.runId ? `lage:${c.runId}` : null),
      boardRunId: c.runId ?? null,
      workRunId: c.workRunId ?? null,
      at: now,
    })
    .run();
  return true;
}

/** An id list in a JSON column, with `from` replaced by `to` (once). */
const swapId = (json: string, from: number, to: number) => JSON.stringify([...new Set(parse<unknown[]>(json, []).map((x) => (x === from ? to : x)))]);

/**
 * An open todo merged into another (the survivor, the older one): it gives its content to the survivor
 * (absorb), everything that pointed to it follows - runs, time records, booking suggestions,
 * appointments, branch links, the todos that follow it up - and it is closed (dismissed, `merged_into`),
 * not deleted, so /t/<id> and old references still lead somewhere. Its own history stays on it. False: either isn't open.
 */
export function mergeInto(survivorId: number, loserId: number, actor: string | null): boolean {
  if (survivorId === loserId) return false;
  const db = getDb();
  const loser = db.select().from(todos).where(eq(todos.id, loserId)).get();
  const survivor = db.select({ status: todos.status }).from(todos).where(eq(todos.id, survivorId)).get();
  if (!loser || loser.status !== "open" || survivor?.status !== "open") return false;
  const last = db.select({ m: sql<number>`coalesce(max(${todoEvents.id}), 0)` }).from(todoEvents).get()?.m ?? 0;
  const ok = absorb(survivorId, {
    ticket: loser.ticket,
    text: loser.text,
    kind: loser.kind,
    ops: parse<unknown[]>(loser.ops, []),
    refs: parse<string[]>(loser.refs, []),
    mailRefs: parse<string[]>(loser.mailRefs, []),
    due: loser.due,
    draft: loser.draft,
    channel: loser.channel,
    target: loser.target,
    planned: cleanPlan(parse<unknown[]>(loser.planned, []), loser.ticket),
    userNotes: parse<TodoUserNote[]>(loser.userNotes, []),
    knowledge: loser.knowledge,
    flaggedAt: loser.flaggedAt,
    needsInput: loser.needsInput,
    runId: null,
    workRunId: null,
    at: loser.createdAt,
    from: `${todoRef(loserId)}${loser.source ? ` (${loser.source})` : ""}`,
    actor,
  });
  if (!ok) return false;
  // Everything that pointed to the merged one follows the survivor.
  db.update(workRuns).set({ todoId: survivorId }).where(eq(workRuns.todoId, loserId)).run();
  db.update(todoTime).set({ todoId: survivorId }).where(eq(todoTime.todoId, loserId)).run();
  db.update(calendarEvents).set({ todoId: survivorId }).where(eq(calendarEvents.todoId, loserId)).run();
  db.run(sql`update or ignore ${todoLinks} set todo_id = ${survivorId} where todo_id = ${loserId}`);
  db.delete(todoLinks).where(eq(todoLinks.todoId, loserId)).run();
  for (const s of db.select({ id: entrySuggestions.id, todoIds: entrySuggestions.todoIds }).from(entrySuggestions).where(like(entrySuggestions.todoIds, `%${loserId}%`)).all())
    db.update(entrySuggestions).set({ todoIds: swapId(s.todoIds, loserId, survivorId) }).where(eq(entrySuggestions.id, s.id)).run();
  // Follow-ups of the merged one are the survivor's now; the survivor itself never follows up on the merged one.
  db.update(todos).set({ parentId: survivorId }).where(and(eq(todos.parentId, loserId), sql`${todos.id} <> ${survivorId}`)).run();
  db.update(todos).set({ parentId: null }).where(and(eq(todos.id, survivorId), eq(todos.parentId, loserId))).run();
  // Closed, not deleted. Its comments and messages are NOT settled with it (the survivor carries them).
  const now = new Date().toISOString();
  db.update(todos)
    .set({ status: "dismissed", note: `Merged into ${todoRef(survivorId)}.`, doneAt: now, updatedAt: now, mergedInto: survivorId, workerDone: null, needsInput: null })
    .where(eq(todos.id, loserId))
    .run();
  // The status trigger logged a dismissal; the survivor's "merged" record is the one story of it.
  db.delete(todoEvents).where(and(eq(todoEvents.todoId, loserId), eq(todoEvents.event, "dismissed"), gt(todoEvents.id, last))).run();
  return true;
}

/** The ids of todos merged into this one, directly or by a chain (a merged one that was a survivor before). */
export function mergedIntoChain(id: number): number {
  const db = getDb();
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const next = db.select({ m: todos.mergedInto }).from(todos).where(eq(todos.id, cur)).get()?.m;
    if (!next) break;
    cur = next;
  }
  return cur;
}
