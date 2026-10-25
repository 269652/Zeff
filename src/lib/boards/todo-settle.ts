import { getSqlite } from "@/db";
import { withCause } from "@/lib/cause";
import { allocationsOf, deallocate } from "@/lib/money/ledger";
import { onTodoCreated, onTodoDone, onTodoReopened } from "./done-hooks";
import type { TodoView } from "./shared";
import { getTodo } from "./store";

/**
 * What hangs on a todo — and on anything else that proves a thing done: the things it settles — a case's instalment, a promise you
 * made, a debt — named by refs ("case:3", "claim:44", "debt:3442"). The proof (Evidence) is a todo ticked off, a booking on the bank
 * statement that no todo and no case took (the fallback: a transfer you made without a todo), or "paid" said by hand on a debt or a
 * case. The plugins say how to find the things (from the proof itself: its sources, its amount, who was paid; and from what was found
 * before — a debt from the promise it was written down from) and what settling one means. Each is settled once per proof (kept: what
 * settled it, and how it was before), so every view can depend on it; the proof taken back (the todo opened again, the "paid" undone),
 * each is taken back. What settling writes is caused by the proof ("T-130" in a row's history). The core knows none of them. Server only.
 */

/** What proves things done. */
export type Evidence = {
  /** Its key, unique: "todo:130", "tx:<booking id>", "hand:<n>". */
  key: string;
  /** How it is named as a cause and in views: "T-130", "Buchung 23.10.", "von Hand". */
  label: string;
  text: string;
  /** Where it comes from (a todo's sources: mails, chats, documents). */
  refs: string[];
  /** A todo's actions (its transfer) — none for the others. */
  ops: TodoView["ops"];
  /** The todo, when it is one. */
  todoId: number | null;
  /** The money it paid, when it says so itself (a booking, by hand) — a todo's comes from its transfer and its text. */
  amount: number | null;
  /** Who was paid (a booking's other side). */
  payee?: { name: string; iban: string };
  /** The day it happened (YYYY-MM-DD). */
  date: string;
  /** What it is for, named (by hand: the debt or the case it was said on) — found before any finder runs. */
  targets?: string[];
};

type Finder = (e: Evidence, found: readonly string[]) => string[];
/**
 * Settles a ref for a proof (its amount, when it says one; everything found on it): false — nothing to settle; true — settled;
 * { undo } — settled, and how it was before (kept, handed to the kind's unsettler when the proof is taken back).
 */
type Settler = (ref: string, e: Evidence, amount: number | null, found: readonly string[]) => boolean | { undo: unknown };
/** Takes back what settling a ref did — with what the settler kept, and the proof's key. */
type Unsettler = (ref: string, undo: unknown, key: string) => void;
/** A ref's name and page, for the views ("Vorgang DR II 789/26"). */
type Labeler = (ref: string) => { title: string; href: string | null } | null;

const finders: Finder[] = [];
const settlers = new Map<string, Settler>();
const unsettlers = new Map<string, Unsettler>();
const labelers = new Map<string, Labeler>();

/** A plugin's way to find what hangs on a proof. Finders run in turn until nothing new is found (a debt from a promise found before). */
export const todoLinkFinder = (f: Finder): void => void (finders.includes(f) || finders.push(f));
/** What settling a ref of this kind ("case", "claim" …) means — and taking it back. */
export const todoSettler = (kind: string, s: Settler, undo?: Unsettler): void => {
  settlers.set(kind, s);
  if (undo) unsettlers.set(kind, undo);
};
/** How a ref of this kind is named and where its page is. */
export const refLabeler = (kind: string, l: Labeler): void => void labelers.set(kind, l);

const today = () => new Date().toLocaleDateString("sv-SE");

/** A todo as a proof. */
export const evidenceOfTodo = (todo: TodoView): Evidence => ({ key: `todo:${todo.id}`, label: todo.ref, text: todo.text, refs: todo.refs, ops: todo.ops, todoId: todo.id, amount: null, date: (todo.doneAt ?? new Date().toISOString()).slice(0, 10) });

const asEvidence = (x: TodoView | Evidence): Evidence => ("key" in x && typeof x.key === "string" && "label" in x ? (x as Evidence) : evidenceOfTodo(x as TodoView));

/** Everything that hangs on the proof (or the todo), in the order found (what a settler of a later one may need settled first). */
export function linkedRefs(x: TodoView | Evidence): string[] {
  const e = asEvidence(x);
  const found: string[] = [...(e.targets ?? [])];
  for (let round = 0; round < 4; round++) {
    let more = false;
    for (const f of finders) {
      let refs: string[] = [];
      try {
        refs = f(e, found);
      } catch (err) {
        console.warn("[todo settle]", err instanceof Error ? err.message : err);
      }
      for (const r of refs) if (!found.includes(r)) (found.push(r), (more = true));
    }
    if (!more) break;
  }
  return found;
}

let ready = false;

function table() {
  const sqlite = getSqlite();
  if (ready) return sqlite;
  sqlite.exec("create table if not exists settled (subject text not null, ref text not null, at text not null, undo text, label text not null default '', primary key (subject, ref))");
  // (What todos settled before proofs of any kind: kept, as "todo:<id>".)
  if (sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = 'todo_settled'").get()) {
    const cols = (sqlite.prepare("pragma table_info(todo_settled)").all() as { name: string }[]).map((c) => c.name);
    sqlite.exec(`insert or ignore into settled (subject, ref, at, undo, label) select 'todo:' || todo_id, ref, at, ${cols.includes("undo") ? "undo" : "null"}, 'T-' || todo_id from todo_settled`);
    sqlite.exec("drop table todo_settled");
  }
  ready = true;
  return sqlite;
}

/** The euro amounts a text names ("40 € und 20 €" → [40, 20]; "1.234,56 €" → 1234.56), in order. */
export function euroAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euro\b)/gi)) {
    const n = Number(m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : /\.\d{3}$/.test(m[1]) ? m[1].replace(/\./g, "") : m[1]);
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n * 100) / 100);
  }
  return out;
}

const opAmount = (todo: Pick<TodoView, "ops">): number | null => {
  const op = todo.ops.find((o) => (o.type === "bank-transfer" || o.type === "revolut-pay") && Number((o as { amount?: unknown }).amount) > 0) as { amount?: unknown } | undefined;
  return op ? Math.round(Number(op.amount) * 100) / 100 : null;
};

/** The money a proof pays: what it says itself (a booking, by hand), a todo's transfer, else the first euro amount it names. Null: none. */
export function todoAmount(x: Pick<TodoView, "text" | "ops"> & { amount?: number | null }): number | null {
  return x.amount ?? opAmount(x) ?? euroAmounts(x.text)[0] ?? null;
}

/** Every amount a proof names — its own, its transfer's, those in its text ("40 € und 20 €"): what a promise's amount is matched against. */
export function todoAmounts(x: Pick<TodoView, "text" | "ops"> & { amount?: number | null }): number[] {
  const op = opAmount(x);
  return [...new Set([...(x.amount != null ? [x.amount] : []), ...(op != null ? [op] : []), ...euroAmounts(x.text)])];
}

/** A proof: each thing hanging on it settled — once, however often it comes. The refs settled now. */
export function settleEvidence(e: Evidence): string[] {
  const sqlite = table();
  const amount = todoAmount(e);
  const now: string[] = [];
  const found = linkedRefs(e);
  for (const ref of found) {
    if (sqlite.prepare("select 1 from settled where subject = ? and ref = ?").get(e.key, ref)) continue;
    const settle = settlers.get(ref.split(":")[0]);
    if (!settle) continue;
    let r: ReturnType<Settler>;
    try {
      r = withCause(e.label, () => settle(ref, e, amount, found));
    } catch (err) {
      console.warn(`[todo settle] ${ref}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (r === false) continue;
    const undo = typeof r === "object" ? JSON.stringify(r.undo ?? null) : null;
    sqlite.prepare("insert or ignore into settled (subject, ref, at, undo, label) values (?, ?, ?, ?, ?)").run(e.key, ref, new Date().toISOString(), undo, e.label);
    now.push(ref);
  }
  // What it settled may have moved on (the case's next instalment): the open todos hanging on it follow.
  if (now.length) void import("./store").then(({ listTodos }) => syncDues(listTodos({ status: "open" })));
  return now;
}

/** A todo done: each thing hanging on it settled. The refs settled now. */
export function settleLinked(todoId: number): string[] {
  const todo = getTodo(todoId);
  return todo ? settleEvidence(evidenceOfTodo(todo)) : [];
}

/** What settled a thing, and when — for a view to say "done by …" (`todoId` when it was a todo). */
export const settledBy = (ref: string): { subject: string; label: string; todoId: number | null; at: string }[] =>
  (table().prepare("select subject, label, at from settled where ref = ? order by at").all(ref) as { subject: string; label: string; at: string }[]).map((r) => ({
    ...r,
    todoId: r.subject.startsWith("todo:") ? Number(r.subject.slice(5)) : null,
  }));

/** What a proof settled (its refs, the newest last). */
export const settledFrom = (key: string): string[] => (table().prepare("select ref from settled where subject = ? order by rowid").all(key) as { ref: string }[]).map((r) => r.ref);

/** A proof taken back: what it settled taken back, newest first (a debt before the promise it came from). The refs taken back. */
export function unsettle(key: string, label = key): string[] {
  const sqlite = table();
  const rows = sqlite.prepare("select ref, undo from settled where subject = ? order by rowid desc").all(key) as { ref: string; undo: string | null }[];
  const back: string[] = [];
  for (const r of rows) {
    const undo = unsettlers.get(r.ref.split(":")[0]);
    try {
      if (undo) withCause(label, () => undo(r.ref, r.undo ? JSON.parse(r.undo) : null, key));
    } catch (err) {
      console.warn(`[todo settle] back ${r.ref}:`, err instanceof Error ? err.message : err);
      continue;
    }
    sqlite.prepare("delete from settled where subject = ? and ref = ?").run(key, r.ref);
    back.push(r.ref);
  }
  return back;
}

/** A done todo opened again: what it settled taken back. */
export const unsettleLinked = (todoId: number): string[] => unsettle(`todo:${todoId}`, getTodo(todoId)?.ref ?? `T-${todoId}`);

/** A ref named for a view — by its kind's labeler; else the ref itself. */
export function refLabel(ref: string): { ref: string; title: string; href: string | null } {
  try {
    const l = labelers.get(ref.split(":")[0])?.(ref);
    if (l) return { ref, ...l };
  } catch {
    // (a ref whose thing is gone)
  }
  return { ref, title: ref, href: null };
}

/** What a Workspace row stands for, by kind (a debt's row: "debt:<id>", a case's row: "case:<id>") — the plugins say. */
type RowRefs = (rowId: number) => string[];
const rowRefFinders: RowRefs[] = [];
export const rowRefs = (f: RowRefs): void => void (rowRefFinders.includes(f) || rowRefFinders.push(f));
export const refsOfRow = (rowId: number): string[] => [...new Set(rowRefFinders.flatMap((f) => { try { return f(rowId); } catch { return []; } }))];

/** What "paid" by hand pays by default on a thing (its instalment, else what is open) — null: it can't be paid. */
type Payable = (ref: string) => number | null;
const payables = new Map<string, Payable>();
export const refPayable = (kind: string, p: Payable): void => void payables.set(kind, p);

/** `payments`: what the ledger allocated to it (lib/money/ledger.ts) — each can be released (a wrong match). */
export type LinkedThing = { ref: string; title: string; href: string | null; settledBy: { subject: string; label: string; todoId: number | null; at: string }[]; pay: number | null; payments: { paymentId: number; key: string; label: string; date: string; amount: number; source: string; tx: string | null }[] };

/**
 * What hangs together with a thing, for its page: the thing (its name, what settled it and when, what "paid" pays), the open todos
 * that would settle it when ticked off — and, for a todo, everything it settles or settled.
 */
export function linksOf(target: { refs: string[] } | { todoId: number }, opts: { openTodos?: TodoView[] } = {}): { things: LinkedThing[]; todos: { id: number; ref: string; text: string; due: string | null }[] } {
  const thing = (ref: string): LinkedThing => {
    let pay: number | null = null;
    try {
      pay = payables.get(ref.split(":")[0])?.(ref) ?? null;
    } catch {
      pay = null;
    }
    const payments = allocationsOf(ref).map((a) => ({ paymentId: a.paymentId, key: a.key, label: a.label, date: a.date, amount: a.amount, source: a.source, tx: a.tx }));
    return { ...refLabel(ref), settledBy: settledBy(ref), pay, payments };
  };
  if ("todoId" in target) {
    const todo = getTodo(target.todoId);
    if (!todo) return { things: [], todos: [] };
    const refs = [...new Set([...linkedRefs(todo), ...settledFrom(`todo:${todo.id}`)])];
    return { things: refs.map(thing), todos: [] };
  }
  const wanted = new Set(target.refs);
  // The open todos that hang on it (a payment todo of the case, the promise's todo) — the newest first, a few hundred at most.
  const open = (opts.openTodos ?? []).slice(0, 300);
  const todos = open.filter((t) => linkedRefs(t).some((r) => wanted.has(r))).map((t) => ({ id: t.id, ref: t.ref, text: t.text, due: t.due ?? null }));
  return { things: target.refs.map(thing), todos };
}

/**
 * A payment released from a thing (it was matched wrongly — another person's transfer, another debt): its allocation off, the thing's
 * figures back, and the proof it came from no longer settles it (opened again, it takes back nothing there).
 */
export function releasePayment(paymentId: number, ref: string): void {
  const key = (allocationsOf(ref).find((a) => a.paymentId === paymentId) ?? null)?.key;
  deallocate(paymentId, ref);
  if (key) table().prepare("delete from settled where subject = ? and ref = ?").run(key, ref);
}

/** "Paid" said by hand on a thing (a debt, a case): a proof of its own, settled like any — its key, to take it back. */
export function settleByHand(target: string, amount: number | null, label: string, date = today()): { key: string; settled: string[] } {
  const key = `hand:${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { key, settled: settleEvidence({ key, label, text: "", refs: [], ops: [], todoId: null, amount, date, targets: [target] }) };
}

// ---------------------------------------------------------------------------
// One due date: a todo that hangs on a thing with a date (a case's next instalment, a debt's, a promise's) is due when it is
// ---------------------------------------------------------------------------

/** A thing's due day (YYYY-MM-DD) — and, for one that takes it from its todo (a debt of your own), how the todo's is written back. */
type Due = { dueOf: (ref: string) => string | null; setDue?: (ref: string, day: string | null) => void };
const dues = new Map<string, Due>();
/** The due day of a ref's kind — the first of a todo's things that has one is the todo's. */
export const refDue = (kind: string, d: Due): void => void dues.set(kind, d);

/** The due day a todo takes from what it hangs on (the first thing that has one) — null: none of them has one. */
/** Whose date wins when a todo hangs on several things: the case's instalment, then the debt's, then the promise's, then the rest. */
const DUE_FIRST = ["case", "debt", "claim"];
const duePriority = (ref: string) => {
  const i = DUE_FIRST.indexOf(ref.split(":")[0]);
  return i < 0 ? DUE_FIRST.length : i;
};

export function dueFromLinks(todo: TodoView): { ref: string; due: string } | null {
  for (const ref of [...linkedRefs(todo)].sort((a, b) => duePriority(a) - duePriority(b))) {
    try {
      const due = dues.get(ref.split(":")[0])?.dueOf(ref) ?? null;
      if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) return { ref, due };
    } catch {
      // (a thing that is gone)
    }
  }
  return null;
}

/** An open todo's due day brought to what it hangs on (a new todo, a case whose instalment moved on). Whether it changed. */
export function syncTodoDue(todoId: number): boolean {
  const todo = getTodo(todoId);
  if (!todo || todo.status !== "open") return false;
  const from = dueFromLinks(todo);
  if (!from || from.due === todo.due) return false;
  void import("./store").then(({ setTodoDue }) => withCause(refLabel(from.ref).title, () => setTodoDue(todoId, from.due)));
  return true;
}

/** Every open todo's due day brought to what it hangs on (the Lage's run, after payments). How many changed. */
export function syncDues(open: TodoView[]): number {
  let n = 0;
  for (const t of open) if (syncTodoDue(t.id)) n++;
  return n;
}

/** A todo's due day set by you: written back to the things that take theirs from it (a debt of your own). */
export function pushTodoDue(todoId: number): void {
  const todo = getTodo(todoId);
  if (!todo) return;
  for (const ref of linkedRefs(todo)) {
    const d = dues.get(ref.split(":")[0]);
    try {
      d?.setDue?.(ref, todo.due);
    } catch {
      // (a thing that is gone)
    }
  }
}

onTodoDone((id) => void settleLinked(id));
onTodoReopened((id) => void unsettleLinked(id));
onTodoCreated((id) => void syncTodoDue(id));
