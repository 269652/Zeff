import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import type { AskField } from "./flows/types";

/**
 * Questions to you — whoever asks: a flow's step (a check-in, an approval), an agent in its run (zeff_ask: it waits for the answer
 * and goes on with it), anything else that needs you. One place: the card on every page shows what is open; an answer is checked
 * against the question's fields and handed to whoever asked (a flow goes on; an agent picks it up). An unanswered question lapses at
 * its time; one asked again under the same key replaces the one still open (an hourly question doesn't pile up). Server only.
 */

export type AskSource = { kind: "flow"; runId: number } | { kind: "agent"; label: string; workRunId?: number | null } | { kind: "other"; label: string };
export type AskStatus = "open" | "answered" | "expired" | "cancelled";
export type Ask = { id: number; title: string; text: string; fields: AskField[]; source: AskSource; from: string; status: AskStatus; answers: Record<string, unknown> | null; replaceKey: string | null; createdAt: string; expiresAt: string | null; answeredAt: string | null };
type Row = { id: number; title: string; text: string; fields: string; source: string; from_label: string; status: string; answers: string | null; replace_key: string | null; created_at: string; expires_at: string | null; answered_at: string | null };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_asks (id integer primary key autoincrement, title text not null, text text not null default '', fields text not null, source text not null, from_label text not null default '', status text not null default 'open', answers text, replace_key text, created_at text not null, expires_at text, answered_at text);
    create index if not exists ws_asks_open on ws_asks (status, expires_at);
  `);
  return d;
}

const parse = <T>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};
const toAsk = (r: Row): Ask => ({ id: r.id, title: r.title, text: r.text, fields: parse(r.fields, []), source: parse(r.source, { kind: "other", label: "" }), from: r.from_label, status: r.status as AskStatus, answers: parse(r.answers, null), replaceKey: r.replace_key, createdAt: r.created_at, expiresAt: r.expires_at, answeredAt: r.answered_at });

/** What happens when an ask of a source ends (answered, lapsed, replaced): a flow's run goes on or ends. */
type Handler = (ask: Ask) => void | Promise<void>;
const handlers: Partial<Record<AskSource["kind"], Handler>> = {};
export const onAskEnded = (kind: AskSource["kind"], fn: Handler) => void (handlers[kind] = fn);

export const getAsk = (id: number): Ask | null => {
  const r = db().prepare("select * from ws_asks where id = ?").get(id) as Row | undefined;
  return r ? toAsk(r) : null;
};

/** The questions open now, newest first. */
export const openAsks = (): Ask[] => (db().prepare("select * from ws_asks where status = 'open' order by id desc limit 50").all() as Row[]).map(toAsk);

async function end(a: Ask, status: AskStatus, answers: Record<string, unknown> | null): Promise<Ask> {
  db().prepare("update ws_asks set status = ?, answers = ?, answered_at = ? where id = ? and status = 'open'").run(status, answers ? JSON.stringify(answers) : null, new Date().toISOString(), a.id);
  const done = getAsk(a.id)!;
  emitChange("workspace");
  // A flow's question: its engine takes it (called directly — a registry could be another copy of this module in another bundle).
  if (a.source.kind === "flow") await (await import("./flows/engine")).flowAskEnded(done);
  else await handlers[a.source.kind]?.(done);
  return done;
}

/** A question asked. `replaceKey`: the open one under the same key ends (replaced). `expiresMinutes`: unanswered that long, it lapses. */
export async function askUser(v: { title: string; text?: string; fields: AskField[]; source: AskSource; from: string; replaceKey?: string; expiresMinutes?: number }): Promise<Ask> {
  if (v.replaceKey) for (const old of (db().prepare("select * from ws_asks where status = 'open' and replace_key = ?").all(v.replaceKey) as Row[]).map(toAsk)) await end(old, "cancelled", null);
  const now = new Date();
  const r = db()
    .prepare("insert into ws_asks (title, text, fields, source, from_label, replace_key, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.title.slice(0, 500), (v.text ?? "").slice(0, 4000), JSON.stringify(v.fields), JSON.stringify(v.source), v.from.slice(0, 200), v.replaceKey ?? null, now.toISOString(), v.expiresMinutes ? new Date(now.getTime() + v.expiresMinutes * 60000).toISOString() : null);
  emitChange("workspace");
  return getAsk(Number(r.lastInsertRowid))!;
}

/** The answers checked against the fields: a scale's or number's within its bounds, a choice one of its options, the required there. */
export function checkAnswers(fields: AskField[], given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = given[f.name];
    if (v === undefined || v === null || v === "") {
      if (f.required) throw new Error(`“${f.label ?? f.name}” needs an answer.`);
      out[f.name] = null;
      continue;
    }
    if (f.kind === "scale" || f.kind === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new Error(`“${f.label ?? f.name}”: a number${f.min !== undefined ? ` from ${f.min}` : ""}${f.max !== undefined ? ` to ${f.max}` : ""}.`);
      out[f.name] = n;
    } else if (f.kind === "choice") {
      if (!(f.options ?? []).includes(String(v))) throw new Error(`“${f.label ?? f.name}”: one of ${(f.options ?? []).join(", ")}.`);
      out[f.name] = String(v);
    } else if (f.kind === "yesno") out[f.name] = v === true || v === "true" || v === "yes";
    else out[f.name] = String(v).slice(0, 4000);
  }
  return out;
}

/** A question answered: checked, kept, handed to whoever asked. */
export async function answerAsk(id: number, given: Record<string, unknown>): Promise<Ask> {
  const a = getAsk(id);
  if (!a) throw new Error("There is no such question.");
  if (a.status !== "open") throw new Error(a.status === "answered" ? "It is answered already." : "It isn't asked any more.");
  return end(a, "answered", { ...checkAnswers(a.fields, given), at: new Date().toISOString() });
}

export async function cancelAsk(id: number): Promise<void> {
  const a = getAsk(id);
  if (a && a.status === "open") await end(a, "cancelled", null);
}

/** The questions whose time is over lapse (the scheduler, every minute). */
export async function expireAsks(now = new Date()): Promise<number> {
  const due = (db().prepare("select * from ws_asks where status = 'open' and expires_at is not null and expires_at <= ?").all(now.toISOString()) as Row[]).map(toAsk);
  for (const a of due) await end(a, "expired", null);
  return due.length;
}

/** Waits for the answer (an agent's question): checks every two seconds, at most `ms`. Null: not answered (yet). */
export async function waitForAnswer(id: number, ms: number, signal?: AbortSignal): Promise<Ask | null> {
  const until = Date.now() + ms;
  for (;;) {
    const a = getAsk(id);
    if (!a || a.status !== "open") return a;
    if (Date.now() >= until || signal?.aborted) return null;
    await new Promise((res) => setTimeout(res, 2000));
  }
}
