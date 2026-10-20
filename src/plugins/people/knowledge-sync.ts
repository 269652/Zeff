/**
 * The People plugin and the knowledge server (the Knowledge plugin): what you confirm about someone
 * becomes knowledge of their entity there, and one person the knowledge keeps twice ("U. Nathanael",
 * "Nathanael") is merged once you say so. Sending waits in an outbox (knowledge_outbox) while the
 * server is down: it is sent on the next confirmation or the next sync. Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import type { Person } from "./shared";
import { getPerson, rememberEntity } from "./store";

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists knowledge_outbox (id integer primary key autoincrement, key text not null unique, person_id integer not null, entity_id integer, ref text not null, text text not null default '', attempts integer not null default 0, error text not null default '', created_at text not null, sent_at text);
    create table if not exists people_kmerge (id integer primary key autoincrement, person_id integer not null, keep_id integer not null, ids text not null, names text not null default '[]', status text not null default 'pending', created_at text not null, decided_at text, unique (person_id, ids));
  `);
  return d;
}

const now = () => new Date().toISOString();
/** After this many failed attempts an entry is given up (the knowledge refuses it — not just down). */
const MAX_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// Confirmed claims → the knowledge
// ---------------------------------------------------------------------------

type ORow = { id: number; key: string; person_id: number; entity_id: number | null; ref: string; text: string; attempts: number; error: string; created_at: string; sent_at: string | null };
export type OutboxEntry = { id: number; personId: number; entityId: number | null; ref: string; text: string; attempts: number; error: string };
const toEntry = (r: ORow): OutboxEntry => ({ id: r.id, personId: r.person_id, entityId: r.entity_id, ref: r.ref, text: r.text, attempts: r.attempts, error: r.error });

/** What waits to be sent. */
export const pendingKnowledge = (): OutboxEntry[] => (db().prepare("select * from knowledge_outbox where sent_at is null and attempts < ? order by id").all(MAX_ATTEMPTS) as ORow[]).map(toEntry);

/**
 * A claim reviewed: confirmed, its text goes to the person's entity; rejected (or no longer confirmed)
 * after it was queued once, it is taken out again (an empty text). Whether something was queued.
 */
export function claimReviewed(claimId: number): boolean {
  const d = db();
  const c = d.prepare("select person_id, text, status from people_claims where id = ?").get(claimId) as { person_id: number; text: string; status: string } | undefined;
  const key = `claim:${claimId}`;
  const had = d.prepare("select person_id, text from knowledge_outbox where key = ?").get(key) as { person_id: number; text: string } | undefined;
  // Gone (deleted with its fact) counts as no longer confirmed.
  const text = c?.status === "confirmed" ? c.text : "";
  const personId = c?.person_id ?? had?.person_id;
  if (!personId || (!had && !text)) return false;
  // Already there as it is: nothing to send.
  if (had && had.text === text) return false;
  d.prepare(
    `insert into knowledge_outbox (key, person_id, entity_id, ref, text, created_at) values (?, ?, ?, ?, ?, ?)
     on conflict(key) do update set person_id = excluded.person_id, entity_id = coalesce(excluded.entity_id, entity_id), text = excluded.text, attempts = 0, error = '', sent_at = null`,
  ).run(key, personId, getPerson(personId)?.entityId ?? null, key, text, now());
  return true;
}

export type FlushDeps = {
  /** Send one fact to an entity (the knowledge client's). */
  sendFact?: (entityId: number, v: { ref: string; text: string }) => Promise<unknown>;
  /** The entity of a profile that has none kept yet (looked up in the knowledge). */
  entityOf?: (p: Person) => Promise<number | null>;
};

const realSend: NonNullable<FlushDeps["sendFact"]> = async (entityId, v) => (await import("@/plugins/knowledge/client")).knowledgePersonFact(entityId, v);
const realEntityOf: NonNullable<FlushDeps["entityOf"]> = async (p) => {
  const { knowledgePersons } = await import("@/plugins/knowledge/client");
  const { knowledgeEntitiesOf } = await import("./identity");
  return knowledgeEntitiesOf(p, await knowledgePersons())[0]?.id ?? null;
};

const flag = globalThis as unknown as { __zeffKnowledgeOutbox?: Promise<{ sent: number; failed: number }> };

/**
 * Send what waits — the profile's entity as it is now (merged meanwhile: the kept one). The server not
 * answering stops the run (the rest waits for the next); a profile without an entity waits too.
 */
export function flushKnowledgeOutbox(deps: FlushDeps = {}): Promise<{ sent: number; failed: number }> {
  if (flag.__zeffKnowledgeOutbox) return flag.__zeffKnowledgeOutbox;
  const run = (async () => {
    const send = deps.sendFact ?? realSend;
    const entityOf = deps.entityOf ?? realEntityOf;
    const d = db();
    let sent = 0;
    let failed = 0;
    for (const e of pendingKnowledge().slice(0, 100)) {
      const p = getPerson(e.personId);
      let entityId = p?.entityId ?? e.entityId;
      if (!entityId && p) {
        entityId = await entityOf(p).catch(() => null);
        if (entityId) rememberEntity(p.id, entityId);
      }
      if (!entityId) continue;
      try {
        await send(entityId, { ref: e.ref, text: e.text });
        d.prepare("update knowledge_outbox set entity_id = ?, sent_at = ?, error = '' where id = ?").run(entityId, now(), e.id);
        sent++;
      } catch (err) {
        const message = errorMessage(err);
        d.prepare("update knowledge_outbox set attempts = attempts + 1, error = ? where id = ?").run(message.slice(0, 300), e.id);
        failed++;
        if (/answering|ECONNREFUSED|fetch failed/i.test(message)) break;
      }
    }
    return { sent, failed };
  })().finally(() => {
    flag.__zeffKnowledgeOutbox = undefined;
  });
  flag.__zeffKnowledgeOutbox = run;
  return run;
}

/** In the background, when the knowledge is there: send what waits. */
export function flushSoon(): void {
  if (!isInstalled("knowledge")) return;
  void flushKnowledgeOutbox().catch((e) => console.warn("[people → knowledge]", errorMessage(e)));
}

// ---------------------------------------------------------------------------
// One profile, several entities: merged in the knowledge
// ---------------------------------------------------------------------------

type MRow = { id: number; person_id: number; keep_id: number; ids: string; names: string; status: string };
export type KnowledgeMerge = { id: number; personId: number; keepId: number; dropIds: number[]; names: string[] };
const parse = (s: string): unknown[] => {
  try {
    return JSON.parse(s) as unknown[];
  } catch {
    return [];
  }
};
const toMerge = (r: MRow): KnowledgeMerge => {
  const ids = parse(r.ids).map(Number);
  return { id: r.id, personId: r.person_id, keepId: r.keep_id, dropIds: ids.filter((x) => x !== r.keep_id), names: parse(r.names).map(String) };
};

/**
 * The knowledge's entities of one profile, when there are several: a proposal to make them one (the
 * first stays — the best match). The same set again: the same proposal (or none, rejected). A waiting
 * one for another set goes. Null: nothing to propose.
 */
export function proposeKnowledgeMerge(personId: number, entities: { id: number; name: string }[]): KnowledgeMerge | null {
  const d = db();
  const list = entities.filter((e, i) => entities.findIndex((x) => x.id === e.id) === i);
  const ids = JSON.stringify(list.map((e) => e.id).sort((a, b) => a - b));
  d.prepare("update people_kmerge set status = 'obsolete', decided_at = ? where person_id = ? and status = 'pending' and ids != ?").run(now(), personId, ids);
  if (list.length < 2) return null;
  d.prepare("insert or ignore into people_kmerge (person_id, keep_id, ids, names, created_at) values (?, ?, ?, ?, ?)").run(personId, list[0].id, ids, JSON.stringify(list.map((e) => e.name)), now());
  const r = d.prepare("select * from people_kmerge where person_id = ? and ids = ?").get(personId, ids) as MRow;
  return r.status === "pending" ? toMerge(r) : null;
}

/** The merge waiting for this profile. */
export function knowledgeMergeOf(personId: number): KnowledgeMerge | null {
  const r = db().prepare("select * from people_kmerge where person_id = ? and status = 'pending' order by id desc").get(personId) as MRow | undefined;
  return r ? toMerge(r) : null;
}

type MergeFn = (keep: number, drop: number[]) => Promise<unknown>;
const realMerge: MergeFn = async (keep, drop) => (await import("@/plugins/knowledge/client")).knowledgeMergePeople(keep, drop);

/** Merge confirmed: done in the knowledge (its error comes through, the proposal stays); the profile keeps the one that stays. */
export async function acceptKnowledgeMerge(id: number, merge: MergeFn = realMerge): Promise<KnowledgeMerge | null> {
  const d = db();
  const r = d.prepare("select * from people_kmerge where id = ? and status = 'pending'").get(id) as MRow | undefined;
  if (!r) return null;
  const m = toMerge(r);
  await merge(m.keepId, m.dropIds);
  if (getPerson(m.personId)) rememberEntity(m.personId, m.keepId);
  d.prepare("update people_kmerge set status = 'accepted', decided_at = ? where id = ?").run(now(), id);
  // What waits for the merged-away ones goes to the one that stays.
  const upd = d.prepare("update knowledge_outbox set entity_id = ? where entity_id = ? and sent_at is null");
  for (const x of m.dropIds) upd.run(m.keepId, x);
  emitChange("todos");
  return m;
}

export function rejectKnowledgeMerge(id: number): void {
  db().prepare("update people_kmerge set status = 'rejected', decided_at = ? where id = ? and status = 'pending'").run(now(), id);
  emitChange("todos");
}
