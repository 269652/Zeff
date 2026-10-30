import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import type { TodoView } from "@/lib/boards/shared";
import { absenceIn } from "./absence";
import { claimsOf, openCommitments, type Claim } from "./graph";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { listPeople } from "./store";
import { localDay } from "@/lib/dates";

/**
 * Who is away, and what others owe you (the People plugin): an absence read off what was said about them ("Urlaub bis
 * 29.10.") marks the todos that name them; a promise of theirs that wasn't kept — past its day, or a week old without
 * one — is asked about in the review queue (not while they are away), and a yes makes a todo to follow up on its source.
 * Server only.
 */

/** Everyone away on `today` (YYYY-MM-DD), until when — the latest day any claim of theirs says. */
export function awayPeople(today: string): Map<number, { name: string; until: string }> {
  const out = new Map<number, { name: string; until: string }>();
  for (const p of listPeople()) {
    for (const c of claimsOf(p.id)) {
      const a = absenceIn(c.text, today);
      if (a && a.until > (out.get(p.id)?.until ?? "")) out.set(p.id, { name: p.name, until: a.until });
    }
  }
  return out;
}

export type Away = { personId: number; name: string; until: string };

/** The todos that name someone away — by todo id. */
export function awayFor(list: Pick<TodoView, "id" | "text" | "note">[], today: string): Record<number, { away: Away[] }> {
  const away = awayPeople(today);
  if (!away.size) return {};
  // Named as people write them — "Frau Wagner" too, a last name that is no one else's.
  const matcher = mentionMatcher(buildPeopleIndex(listPeople()));
  const out: Record<number, { away: Away[] }> = {};
  for (const todo of list) {
    const ids = new Set(splitMentions(`${todo.text} ${todo.note ?? ""}`, matcher).flatMap((m) => (m.person && away.has(m.person.id) ? [m.person.id] : [])));
    if (ids.size) out[todo.id] = { away: [...ids].map((id) => ({ personId: id, ...away.get(id)! })) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Following up
// ---------------------------------------------------------------------------

function db() {
  const d = getSqlite();
  d.exec("create table if not exists people_followups (claim_id integer primary key, decision text not null, todo_id integer, at text not null)");
  return d;
}

const WAIT_DAYS = 7;

/** Their promises to follow up on: kept by nobody, past their day (or a week old without one), not asked about yet, not while they're away. */
export function followUps(today: string): (Claim & { personName: string })[] {
  const asked = new Set((db().prepare("select claim_id from people_followups").all() as { claim_id: number }[]).map((r) => r.claim_id));
  const away = awayPeople(today);
  const weekAgo = new Date(Date.parse(today) - WAIT_DAYS * 864e5).toISOString();
  // Back from an absence in the last week: what waited on them is due now (no week to wait).
  const back = new Set([...awayPeople(weekAgo.slice(0, 10))].filter(([id, a]) => a.until < today && !away.has(id)).map(([id]) => id));
  return openCommitments().filter((c) => c.direction === "theirs" && !asked.has(c.id) && !away.has(c.personId) && (back.has(c.personId) || (c.due ? c.due < today : c.createdAt < weekAgo)));
}

/** Yes: a todo to follow up, on the promise's source (its mail or letter) — its actions are proposed like any todo's. No: not asked again. */
export async function decideFollowUp(claimId: number, yes: boolean): Promise<{ message?: string }> {
  const c = openCommitments().find((x) => x.id === claimId);
  if (!c) throw new Error(t("This proposal is no longer open."));
  let todoId: number | null = null;
  if (yes) {
    const store = await import("@/lib/boards/store");
    // In German, like the todos Zeff makes from your mails.
    const text = `Bei ${c.personName} nachfassen: ${c.text}`;
    const v = { ticket: "", text, kind: "clarify", refs: [c.sourceRef], runId: null, due: localDay() };
    const made = c.sourceRef.startsWith("doc:") ? store.addDocTodo(v) : store.addMailTodo(v);
    todoId = made.id;
  }
  db().prepare("insert or replace into people_followups (claim_id, decision, todo_id, at) values (?, ?, ?, ?)").run(claimId, yes ? "yes" : "no", todoId, new Date().toISOString());
  return { message: yes ? t("A todo to follow up was made.") : undefined };
}
