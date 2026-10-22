/**
 * "What you should know" (the know plugin): the brief — what Zeff knows that matters now about the people and things of a
 * meeting, a mail, a chat, a ticket, a person or a Workspace row — put together by rule, no AI: who they are (only the facts
 * that hold: current versions, confirmed or sure claims), the last interactions (the timeline), what is still open between you
 * (loops.ts), the tickets, cases, projects and organisations it is about, money owed either way (Finances), a birthday coming up,
 * and the sources it relies on that aren't well (Source health).
 *
 * Every item carries the label of where it was read (lib/boundaries): secret never shows, personal only to a reader with that
 * clearance (you; an agent whose permissions allow it — the MCP sets the clearance per request). What is left out is counted.
 * Server only.
 */
import { createHash } from "node:crypto";
import { getSqlite } from "@/db";
import { allows, currentClearance, maxLabel, refLabels, sourceLabel, type Label } from "@/lib/boundaries";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { absenceIn } from "@/plugins/people/absence";
import { claimsOf, linksOf, SHOW_FROM } from "@/plugins/people/graph";
import { getPerson, upcoming } from "@/plugins/people/store";
import { eventBySource, eventsFor, normRef, type TimelineEvent } from "@/plugins/timeline/store";
import { withEntities } from "@/plugins/timeline/query";
import { hrefOf, labelOf, makeResolver, refsOfRow } from "@/plugins/timeline/refs";
import { currentFacts } from "@/lib/trust/store";
import { attributeLabel } from "@/lib/trust/review";
import { eventById, eventsBetween } from "@/lib/calendar/ir";
import { getEntity } from "@/plugins/entities/store";
import { openLoopsFor } from "./loops";
import type { Brief, BriefEvent, BriefFact, BriefLink, BriefMeeting, BriefPerson, BriefStale } from "./shared";

/** How far back the brief reads the timeline, and how much of it shows. */
const SINCE_DAYS = 180;
const RECENT = 8;
const FACTS = 6;
const RELATED = 10;
/** A date of theirs this close is worth saying. */
const DATE_DAYS = 14;
/** Details that are no conversation topic (paying them is the Finances' and the person page's business). */
const NOT_TOPICS = new Set(["iban", "bic", "bank", "revtag"]);

/** A source's health as the brief reads it (lib/sync/source-health, in words). */
export type HealthLike = { key: string; label: string; href: string; state: string; reason: string };

/** The steps whose data a timeline source is. */
const STEPS_OF: Record<string, string[]> = {
  mail: ["mail"],
  whatsapp: ["whatsapp"],
  signal: ["signal"],
  teams: ["teams"],
  jira: ["jira"],
  gitlab: ["gitlab"],
  calendar: ["calendar", "gcalendar"],
};

/** Of the sources' health, the ones the brief relies on (steps or timeline sources) that aren't well. */
export function staleSources(relied: string[], health: HealthLike[]): BriefStale[] {
  const keys = new Set(relied.flatMap((s) => STEPS_OF[s] ?? [s]));
  return health.filter((h) => keys.has(h.key) && h.state !== "ok").map((h) => ({ key: h.key, label: h.label, href: h.href, state: h.state, reason: h.reason }));
}

async function healthNow(): Promise<HealthLike[]> {
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    const { healthReason } = await import("@/lib/sync/source-health-shared");
    return (await sourceHealth()).map((h) => ({ key: h.key, label: h.label, href: h.href, state: h.state, reason: h.state === "ok" ? "" : healthReason(t, h) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Labels: where each thing was read, and whether the reader may see it
// ---------------------------------------------------------------------------

type Labels = { ref: (ref: string) => Label; event: (e: TimelineEvent) => Label; ok: (l: Label) => boolean };

const SOURCE_KEYS: Record<string, string> = { whatsapp: "whatsapp", signal: "signal", teams: "teams", jira: "jira", gitlab: "gitlab", todos: "todos", time: "time", documents: "documents", bank: "bank" };

function labels(): Labels {
  const byRef = refLabels();
  const clearance = currentClearance();
  const ref = (r: string): Label => (!r || r === "you" ? "open" : byRef(r));
  const event = (e: TimelineEvent): Label => {
    const pages = e.refs.filter((r) => r.startsWith("page:")).map(ref);
    if (e.source === "mail") return maxLabel(ref(`mail:${e.sourceRef}`), ...pages);
    if (e.source === "workspace") {
      const own = /^\/workspace\/(\d+)/.exec(e.url);
      return maxLabel(own ? ref(`page:${own[1]}`) : "open", ...pages);
    }
    const key = SOURCE_KEYS[e.source];
    return maxLabel(key ? sourceLabel(key) : "open", ...pages);
  };
  return { ref, event, ok: (l) => allows(clearance, l) };
}

// ---------------------------------------------------------------------------
// What a thing is about: a row's refs, a meeting's
// ---------------------------------------------------------------------------

/** A mail's timeline source by its key: WhatsApp's and Signal's chats share the mail table. */
const mailSource = (key: string) => (key.startsWith("wa:") ? "whatsapp" : key.startsWith("sg:") ? "signal" : "mail");

/**
 * What a Workspace row is about: itself, the person, case or ticket it stands for (the timeline's refsOfRow) — and for a mail's or
 * a chat message's row (its source ref "mail:<key>" / "teams:<key>"), the message and the people and tickets the timeline found in it.
 */
export function rowRefs(rowId: number): string[] {
  const out = new Set(refsOfRow(rowId));
  let src = "";
  try {
    const r = getSqlite().prepare("select json_extract(props, '$.srcref') s from ws_pages where id = ?").get(rowId) as { s: string | null } | undefined;
    src = String(r?.s ?? "");
  } catch {
    src = "";
  }
  const mail = /^mail:(.+)$/.exec(src);
  const teams = /^teams:(.+)$/.exec(src);
  const ev = mail ? eventBySource(mailSource(mail[1]), mail[1]) : teams ? eventBySource("teams", teams[1]) : null;
  if (mail || teams) out.add(src);
  for (const r of ev?.refs ?? []) if (/^(person|ticket|page|project|org|job|doc):/.test(r)) out.add(r);
  return [...out];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A local time as the calendar keeps it: "YYYY-MM-DDTHH:MM". */
const localAt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayOf = (d: Date) => localAt(d).slice(0, 10);

type CalEvent = { id: number; title: string; start: string; end: string; allDay: boolean; cancelled: boolean; location: string; online: boolean; organizer: string; attendees: string[]; description: string; private: boolean; occurrence: string | null };

/** The people a meeting is with (its attendees and organizer by address or name, the names in its title) and the tickets it names. */
function meetingRefs(e: CalEvent, resolver = makeResolver()): string[] {
  const people = resolver.peopleIn(e.title, e.organizer, ...e.attendees).map((id) => `person:${id}`);
  const tickets = resolver.tickets(`${e.title}\n${e.description}`).map((k) => `ticket:${k}`);
  return [...new Set([...people, ...tickets])];
}

/** Where a meeting's day opens: the Workspace's calendar database, else the calendar's own page. */
async function meetingHref(start: string): Promise<string> {
  const day = start.slice(0, 10);
  const db = isInstalled("workspace") ? await import("@/plugins/workspace/calendar-database").then((m) => m.calendarDatabase()).catch(() => null) : null;
  return db ? `/workspace/${db}?v=day&d=${day}` : `/kalender?v=day&d=${day}`;
}

/**
 * The meetings with someone you know (or a ticket) in them that start between `startedMinutes` ago and `withinMinutes` from now —
 * the soonest first; cancelled and all-day ones never.
 */
export function upcomingMeetings(opts: { now?: Date; withinMinutes?: number; startedMinutes?: number } = {}): { id: number; occurrence: string | null; title: string; start: string; refs: string[] }[] {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - (opts.startedMinutes ?? 0) * 60e3);
  const to = new Date(now.getTime() + (opts.withinMinutes ?? 30) * 60e3);
  let events: CalEvent[] = [];
  try {
    events = eventsBetween(localAt(new Date(from.getTime() - 864e5)), localAt(new Date(to.getTime() + 864e5)));
  } catch {
    return [];
  }
  const resolver = makeResolver();
  return events
    .filter((e) => !e.cancelled && !e.allDay && e.start >= localAt(from) && e.start <= localAt(to))
    .map((e) => ({ id: e.id, occurrence: e.occurrence, title: e.title, start: e.start, refs: meetingRefs(e, resolver) }))
    .filter((m) => m.refs.some((r) => r.startsWith("person:")))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

type Opts = { now?: Date; health?: HealthLike[] | null; label?: string; meeting?: BriefMeeting | null; meetingLabel?: Label };

/** Who someone is, as far as the reader may see: their role, the facts that hold, away, a date coming up, money, the last contact. */
function personOf(id: number, L: Labels, now: Date, allowedEvents: (ref: string) => TimelineEvent[], money: Map<number, { owe: number; owed: number }> | null, hide: () => void): BriefPerson | null {
  const p = getPerson(id);
  if (!p) return null;
  const ref = `person:${id}`;
  const base = sourceLabel("people");
  const person: BriefPerson = { id, ref, name: p.name, href: hrefOf(ref), role: null, facts: [], away: null, birthday: null, money: null, lastContact: null, recentCount: 0 };
  if (!L.ok(base)) {
    hide();
    return person;
  }
  const today = dayOf(now);
  const may = (sourceRef: string) => {
    const ok = L.ok(maxLabel(base, L.ref(sourceRef)));
    if (!ok) hide();
    return ok;
  };
  const claims = claimsOf(id).filter((c) => c.status === "confirmed" || c.confidence >= SHOW_FROM);
  person.role = claims.find((c) => c.kind === "role" && may(c.sourceRef))?.text ?? null;
  const facts: BriefFact[] = [];
  for (const c of claims) {
    if (c.kind !== "fact" && c.kind !== "preference") continue;
    if (!may(c.sourceRef)) continue;
    facts.push({ text: c.text, source: c.sourceRef, at: (c.confirmedAt ?? c.createdAt).slice(0, 10) });
  }
  try {
    for (const v of currentFacts(ref)) {
      if (NOT_TOPICS.has(v.attribute) || !may(v.sourceRef)) continue;
      facts.push({ text: `${attributeLabel(v.attribute)}: ${v.value}`, source: v.sourceRef, at: v.confirmedAt.slice(0, 10) });
    }
  } catch {
    // (trust's table not made yet)
  }
  person.facts = facts.slice(0, FACTS);
  for (const c of claims) {
    if (c.kind === "commitment") continue;
    const a = absenceIn(c.text, today);
    if (a && may(c.sourceRef) && (!person.away || a.until > person.away.until)) person.away = { until: a.until, text: c.text };
  }
  const dates = upcoming({ days: DATE_DAYS, today: now }).filter((u) => u.person.id === id);
  const d = dates.find((u) => u.date.kind === "birthday") ?? dates[0];
  if (d) person.birthday = { on: d.on, inDays: d.inDays, turns: d.turns, label: d.date.kind === "birthday" ? t("Birthday") : d.date.label || t("Date") };
  const m = money?.get(id);
  if (m && (m.owe > 0 || m.owed > 0)) person.money = m;
  const evs = allowedEvents(ref);
  const last = evs[0];
  if (last) person.lastContact = { at: last.at, kind: last.kind, title: last.title, href: last.url };
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  person.recentCount = evs.filter((e) => e.at >= since).length;
  return person;
}

/** Money between you and your people (Finances), when the reader may see it: null otherwise. */
async function moneyMap(L: Labels, hide: () => void): Promise<Map<number, { owe: number; owed: number }> | null> {
  if (!isInstalled("finances")) return null;
  try {
    const { balances, debtsDbId } = await import("@/plugins/finances/debts");
    const db = debtsDbId();
    const label = maxLabel(sourceLabel("bank"), db ? L.ref(`page:${db}`) : "open");
    const all = balances();
    if (!L.ok(label)) {
      if (all.size) hide();
      return null;
    }
    return all;
  } catch {
    return null;
  }
}

/** The cases a person is the other side of, as their rows (refs "page:<row>"). */
function casesOf(personIds: number[]): string[] {
  if (!personIds.length) return [];
  try {
    const rows = getSqlite()
      .prepare(`select p.id from cases c join ws_pages p on json_extract(p.props, '$.srcref') = 'case:' || c.id where p.archived_at is null and c.status = 'open' and c.person_id in (${personIds.map(() => "?").join(",")})`)
      .all(...personIds) as { id: number }[];
    return rows.map((r) => `page:${r.id}`);
  } catch {
    return [];
  }
}

/** An organisation's or place's name (the Entities plugin), else the timeline's label. */
function entityLabel(ref: string): string {
  if (/^(org|place):/.test(ref) && isInstalled("entities")) {
    try {
      return getEntity(ref)?.name ?? ref;
    } catch {
      return ref;
    }
  }
  return labelOf(ref);
}

/**
 * The brief about `refs` (person:…, ticket:…, page:…, mail:…, event:… — what a row, a mail, a meeting is about), as the reader
 * may see it. `health`: the sources' health (null/undefined: read now; [] none — tests). `now`: for "overdue", "in 5 days".
 */
export async function briefFor(refsIn: string[], opts: Opts = {}): Promise<Brief> {
  const now = opts.now ?? new Date();
  const refs = [...new Set(refsIn.map(normRef).filter(Boolean))];
  const L = labels();
  let hidden = 0;
  const hide = () => void hidden++;
  const since = new Date(now.getTime() - SINCE_DAYS * 864e5).toISOString();
  const ownEvent = opts.meeting ? String(opts.meeting.id) : null;
  const notOwn = (e: TimelineEvent) => !(ownEvent && e.source === "calendar" && e.sourceRef === ownEvent);
  const seen = new Set<number>();
  /** The events of a ref the reader may see (each left out counted once). */
  const allowed = (evs: TimelineEvent[]) =>
    evs.filter((e) => {
      const ok = L.ok(L.event(e));
      if (!ok && !seen.has(e.id)) seen.add(e.id), hide();
      return ok && notOwn(e);
    });
  const timelineOn = isInstalled("timeline");
  const read = (r: string | string[], limit: number) => (timelineOn ? allowed(eventsFor(r, { since, limit })) : []);

  const money = isInstalled("people") ? await moneyMap(L, hide) : null;
  const personIds = refs.flatMap((r) => (/^person:\d+$/.test(r) ? [Number(r.slice(7))] : []));
  const people = isInstalled("people") ? personIds.flatMap((id) => personOf(id, L, now, (ref) => read(ref, 40), money, hide) ?? []) : [];

  const loops = (isInstalled("people") ? openLoopsFor(refs, dayOf(now)) : []).filter((l) => {
    const ok = L.ok(maxLabel(sourceLabel("people"), L.ref(l.sourceRef)));
    if (!ok) hide();
    return ok;
  });

  const evs = read(refs.filter((r) => !r.startsWith("event:")), 40);
  const recent: BriefEvent[] = withEntities(evs.slice(0, RECENT), refs).map((e) => ({ id: e.id, at: e.at, kind: e.kind, source: e.source, title: e.title, summary: e.summary, href: e.url, entities: e.entities }));

  // Related: what the refs and their events are about — tickets, cases (rows), projects, organisations — the most named first.
  const counts = new Map<string, number>();
  const bump = (r: string, n = 1) => counts.set(r, (counts.get(r) ?? 0) + n);
  for (const r of refs) if (/^(ticket|project|org):/.test(r)) bump(r, 5);
  for (const e of evs) for (const r of e.refs) if (/^(ticket|project|org):/.test(r)) bump(r);
  for (const c of casesOf(personIds)) bump(c, 3);
  if (isInstalled("people"))
    for (const id of personIds)
      for (const l of linksOf(id)) {
        if (l.targetType === "ticket") bump(`ticket:${l.targetRef.toUpperCase()}`);
        if (l.targetType === "org") bump(`org:${l.targetRef}`, 2);
      }
  if (isInstalled("entities")) {
    try {
      const { projectOf } = await import("@/plugins/entities/resolve");
      for (const r of [...counts.keys()].filter((x) => x.startsWith("ticket:"))) {
        const p = projectOf(r);
        if (p) bump(p);
      }
    } catch {
      // (the entities' tables not made yet)
    }
  }
  const about = new Set(refs);
  const related: BriefLink[] = [...counts.entries()]
    // What it is about itself isn't related to it — but a meeting's tickets (named in its title) are what it is about: shown.
    .filter(([r]) => !about.has(r) || (!!opts.meeting && /^(ticket|project):/.test(r)))
    .filter(([r]) => {
      const ok = L.ok(r.startsWith("ticket:") ? sourceLabel("jira") : L.ref(r));
      if (!ok) hide();
      return ok;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, RELATED)
    .map(([r]) => ({ ref: r, label: entityLabel(r), href: hrefOf(r) }));

  const relied = new Set(evs.map((e) => e.source));
  if (opts.meeting) relied.add("calendar");
  if (related.some((r) => r.ref.startsWith("ticket:"))) relied.add("jira");
  const health = opts.health ?? (await healthNow());
  const stale = staleSources([...relied], health);

  let meeting = opts.meeting ?? null;
  if (meeting && opts.meetingLabel && !L.ok(opts.meetingLabel)) {
    hide();
    meeting = { ...meeting, title: t("(private appointment)"), location: "", attendees: [] };
  }
  const label = opts.label ?? meeting?.title ?? (refs.length ? entityLabel(refs[0]) : "");
  const hash = createHash("sha1")
    .update(
      JSON.stringify({
        m: meeting && [meeting.title, meeting.start, meeting.attendees],
        p: people.map((p) => [p.id, p.name, p.role, p.facts.map((f) => f.text), p.away, p.birthday && [p.birthday.on, p.birthday.label], p.money]),
        l: loops.map((l) => [l.id, l.text, l.due, l.overdue]),
        e: recent.map((e) => e.id),
        r: related.map((r) => r.ref),
      }),
    )
    .digest("hex");
  return { refs, label, meeting, people, loops, recent, related, stale, hidden, hash, at: now.toISOString() };
}

/** The brief of a meeting (by its id in the calendar; `occurrence` the day of a series' one) — null when it is gone. */
export async function meetingBrief(eventId: number, opts: Omit<Opts, "meeting" | "label"> & { occurrence?: string } = {}): Promise<Brief | null> {
  if (!isInstalled("calendar")) return null;
  const e = eventById(eventId, opts.occurrence) as CalEvent | null;
  if (!e) return null;
  const meeting: BriefMeeting = { id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, online: e.online, attendees: [e.organizer, ...e.attendees].filter(Boolean), href: await meetingHref(e.start) };
  return briefFor([`event:${e.id}`, ...meetingRefs(e)], { ...opts, meeting, meetingLabel: e.private ? "personal" : "open" });
}

// ---------------------------------------------------------------------------
// As text (agents over the MCP; the AI summary's input)
// ---------------------------------------------------------------------------

const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** The brief as lines for an agent: what it is about, the people, the open loops, the latest, related, stale sources. */
export function briefText(b: Brief): string {
  const out: string[] = [];
  if (b.meeting) out.push(`Meeting: ${b.meeting.title} — ${day(b.meeting.start)}${b.meeting.location ? ` · ${b.meeting.location}` : ""}${b.meeting.attendees.length ? ` · with ${b.meeting.attendees.join(", ")}` : ""} [event:${b.meeting.id}]`);
  else out.push(`About: ${b.label} [${b.refs.join(", ")}]`);
  if (b.people.length) {
    out.push("", "## People");
    for (const p of b.people) {
      const bits = [p.role, p.away ? `away until ${p.away.until}` : "", p.birthday ? `${p.birthday.label} ${p.birthday.on} (in ${p.birthday.inDays} days)` : "", p.money?.owe ? `you owe them ${euro(p.money.owe)}` : "", p.money?.owed ? `they owe you ${euro(p.money.owed)}` : "", p.lastContact ? `last contact ${day(p.lastContact.at)} (${p.lastContact.kind}: ${p.lastContact.title})` : "", p.recentCount ? `${p.recentCount} interactions in 30 days` : ""].filter(Boolean);
      out.push(`- ${p.name} [${p.ref}]${bits.length ? ` — ${bits.join("; ")}` : ""}`);
      for (const f of p.facts) out.push(`  - ${f.text}${f.source ? ` (${f.source}, ${f.at})` : ""}`);
    }
  }
  if (b.loops.length) {
    out.push("", "## Open loops");
    for (const l of b.loops) out.push(`- ${l.direction === "mine" ? "you owe" : l.direction === "theirs" ? "owed to you" : "open"} (${l.personName}): ${l.text}${l.due ? ` — due ${l.due}${l.overdue ? ", overdue" : ""}` : ""}${l.sourceRef ? ` [${l.sourceRef}]` : ""}`);
  }
  if (b.recent.length) {
    out.push("", "## Latest");
    for (const e of b.recent) out.push(`- ${day(e.at)} | ${e.kind} (${e.source}) | ${e.title}${e.summary && e.summary !== e.title ? ` — ${e.summary.slice(0, 160)}` : ""}${e.href && /^https?:/.test(e.href) ? ` | ${e.href}` : ""}`);
  }
  if (b.related.length) out.push("", "## Related", ...b.related.map((r) => `- ${r.label} [${r.ref}]`));
  if (b.stale.length) out.push("", "## Sources not up to date (this may be missing things)", ...b.stale.map((s) => `- ${s.label}: ${s.state}${s.reason ? ` — ${s.reason}` : ""}`));
  if (b.hidden) out.push("", `(${b.hidden} item(s) left out: personal or secret data this reader may not see.)`);
  return out.join("\n");
}
