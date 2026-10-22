/**
 * The open loops as the pages and agents read them (the loops plugin): the People plugin's commitment claims (what the AI read —
 * every one not rejected, the unsure ones too: recall first) and what the rules read (detect.ts), with what became of each
 * (state.ts) — by view: what I owe, what I'm owed, overdue, closed lately. Server only.
 */
import { getSqlite } from "@/db";
import { getPerson } from "@/plugins/people/store";
import { closeByRule } from "./close";
import { derivedLoops } from "./detect";
import { isOverdue, type Loop, type LoopView } from "./shared";
import { sourceMessage, sourceOf } from "./source";
import { allStates, type StateRow } from "./state";

/** Closed loops stay in the "Closed" view this long. */
const CLOSED_DAYS = 14;
/** The unsure claims below this aren't loops (the extraction keeps nothing below 0.5 anyway). */
const MIN_CONFIDENCE = 0.5;

type CRow = { id: number; person_id: number; text: string; evidence: string; source_ref: string; confidence: number; status: string; direction: string; due: string; done_at: string | null; created_at: string };

const claimRows = (where: string, ...args: unknown[]): CRow[] => {
  try {
    return getSqlite().prepare(`select id, person_id, text, evidence, source_ref, confidence, status, direction, due, done_at, created_at from people_claims where kind = 'commitment' and status in ('proposed', 'confirmed') and confidence >= ${MIN_CONFIDENCE} and direction in ('mine', 'theirs') and ${where}`).all(...args) as CRow[];
  } catch {
    return [];
  }
};

/** A commitment claim as a loop, with its state. */
function claimLoop(c: CRow, st: StateRow | undefined, now: Date): Loop {
  const src = sourceMessage(c.source_ref);
  const person = getPerson(c.person_id);
  const l: Loop = {
    ref: `claim:${c.id}`,
    kind: "commitment",
    direction: c.direction === "theirs" ? "theirs" : "mine",
    origin: "ai",
    personId: c.person_id,
    who: person?.name ?? "?",
    text: c.text,
    quote: c.evidence,
    at: src.at ?? c.created_at,
    due: c.due,
    sourceRef: c.source_ref,
    source: sourceOf(c.source_ref),
    href: src.href,
    confirmed: c.status === "confirmed",
    confidence: c.confidence,
    overdue: false,
    state: c.done_at ? "closed" : "open",
    closedBy: c.done_at ? (st?.closedBy ?? "you") : null,
    closedAt: c.done_at,
    closeQuote: c.done_at ? (st?.closeQuote ?? "") : "",
    closeRef: c.done_at ? (st?.closeRef ?? "") : "",
    proposal: c.done_at ? null : (st?.proposal ?? null),
    snoozedUntil: st?.snoozeUntil ?? null,
  };
  l.overdue = !c.done_at && isOverdue(l, now);
  return l;
}

const withState = (l: Loop, st: StateRow | undefined): Loop => (st ? { ...l, snoozedUntil: st.snoozeUntil, proposal: st.proposal } : l);

/** A rule's loop closed or dismissed: what its snapshot says. */
const fromSnapshot = (st: StateRow): Loop | null => {
  const s = st.snapshot;
  if (!s.ref || !s.kind || !s.direction) return null;
  return { ref: st.ref, kind: s.kind, direction: s.direction, origin: s.origin ?? "rule", personId: s.personId ?? null, who: s.who ?? "?", text: s.text ?? "", quote: s.quote ?? "", at: s.at ?? st.updatedAt, due: s.due ?? "", sourceRef: s.sourceRef ?? "", source: s.source ?? "people", href: s.href ?? "", confirmed: true, confidence: 1, overdue: false, state: st.state, closedBy: st.closedBy, closedAt: st.closedAt, closeQuote: st.closeQuote, closeRef: st.closeRef, proposal: null, snoozedUntil: st.snoozeUntil };
};

const order = (a: Loop, b: Loop) => Number(b.overdue) - Number(a.overdue) || (a.due && b.due ? a.due.localeCompare(b.due) : Number(!!b.due) - Number(!!a.due)) || b.at.localeCompare(a.at);

const g = globalThis as { __zeffLoopsRuleAt?: number };
/** The closing by rule, before a read — at most once a minute (it reads the threads of every open promise). */
function closeSoon(now: Date): void {
  if ((g.__zeffLoopsRuleAt ?? 0) > now.getTime() - 60000) return;
  g.__zeffLoopsRuleAt = now.getTime();
  try {
    closeByRule();
  } catch (e) {
    console.error("[loops] closing by rule", e);
  }
}

export type LoopQuery = { view?: LoopView; personId?: number; now?: Date; limit?: number };

/** The loops of a view (none: every open one), a person's only (`personId`), the overdue and the soonest due first. */
export function listLoops(q: LoopQuery = {}): Loop[] {
  const now = q.now ?? new Date();
  closeSoon(now);
  const states = allStates();
  let out: Loop[];
  if (q.view === "closed") {
    const since = new Date(now.getTime() - CLOSED_DAYS * 864e5).toISOString();
    const claims = claimRows("done_at is not null and done_at >= ?", since).map((c) => claimLoop(c, states.get(`claim:${c.id}`), now));
    const rules = [...states.values()].filter((s) => s.ref.startsWith("q:") && s.state === "closed" && (s.closedAt ?? "") >= since).flatMap((s) => fromSnapshot(s) ?? []);
    out = [...claims, ...rules].sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  } else {
    const claims = claimRows("done_at is null").map((c) => claimLoop(c, states.get(`claim:${c.id}`), now));
    const rules = derivedLoops({ now })
      .filter((l) => {
        const st = states.get(l.ref);
        return !st || st.state === "open";
      })
      .map((l) => withState(l, states.get(l.ref)));
    out = [...claims, ...rules];
    if (q.view === "mine" || q.view === "theirs") out = out.filter((l) => l.direction === q.view);
    if (q.view === "overdue") out = out.filter((l) => l.overdue);
    out.sort(order);
  }
  if (q.personId) out = out.filter((l) => l.personId === q.personId);
  return q.limit ? out.slice(0, q.limit) : out;
}

/** One loop by its ref, whatever became of it (null: unknown — a rule's loop answered and never decided). */
export function findLoop(ref: string, now = new Date()): Loop | null {
  const states = allStates();
  const st = states.get(ref);
  const claim = /^claim:(\d+)$/.exec(ref);
  if (claim) {
    const c = claimRows("id = ?", Number(claim[1]))[0];
    return c ? claimLoop(c, st, now) : null;
  }
  const live = derivedLoops({ now }).find((l) => l.ref === ref);
  if (live) return withState(live, st);
  return st ? fromSnapshot(st) : null;
}

/** The overdue loops for the Today page: not put off ("Later"), yours first, at most `cap`. */
export function nudges(cap: number, now = new Date()): { loops: Loop[]; total: number } {
  const due = listLoops({ view: "overdue", now }).filter((l) => !l.snoozedUntil || l.snoozedUntil <= now.toISOString());
  const sorted = [...due].sort((a, b) => Number(b.direction === "mine") - Number(a.direction === "mine") || order(a, b));
  return { loops: sorted.slice(0, cap), total: due.length };
}

/** How many loops are open, by direction (and overdue). */
export function loopCounts(now = new Date()): { mine: number; theirs: number; overdue: number } {
  const all = listLoops({ now });
  return { mine: all.filter((l) => l.direction === "mine").length, theirs: all.filter((l) => l.direction === "theirs").length, overdue: all.filter((l) => l.overdue).length };
}

export type ThreadLoops = { mine: number; theirs: number; overdue: number; texts: string[] };

/**
 * The open loops of the mails and chats (said in a mail, a WhatsApp or Signal message), by thread (its conv id) and by message
 * (its source ref "mail:<key>") — the chips in the inbox and the chats.
 */
export function mailLoops(now = new Date()): { byThread: Map<string, ThreadLoops>; byMessage: Map<string, Loop[]> } {
  const byThread = new Map<string, ThreadLoops>();
  const byMessage = new Map<string, Loop[]>();
  for (const l of listLoops({ now })) {
    if (!l.sourceRef.startsWith("mail:")) continue;
    const conv = l.sourceRef.slice("mail:".length).split("|")[0];
    const t = byThread.get(conv) ?? { mine: 0, theirs: 0, overdue: 0, texts: [] };
    t[l.direction]++;
    if (l.overdue) t.overdue++;
    t.texts.push(l.text);
    byThread.set(conv, t);
    byMessage.set(l.sourceRef, [...(byMessage.get(l.sourceRef) ?? []), l]);
  }
  return { byThread, byMessage };
}
