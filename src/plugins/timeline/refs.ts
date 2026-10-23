/**
 * Who and what an event concerns, by rule (the Timeline plugin) — no AI: people by their mail address, their name, an alias, their
 * chat's name or their Jira username (a form two people share names neither), and by the names a text mentions; ticket keys in a
 * text (of the projects Zeff knows). And the other way round: a free text an agent or you give ("Laura", "PROJ-12", "Relaunch") as
 * the ref it means, and a ref's label for the pages. Server only.
 */
import { getSqlite } from "@/db";
import { isTicketKey } from "@/lib/ticket-keys";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "@/plugins/people/mentions";
import { listPeople, namesOf } from "@/plugins/people/store";
import type { Person } from "@/plugins/people/shared";
import { normRef } from "./store";

const KEY = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
/** Look like keys, aren't tickets — when Zeff knows no projects to go by. */
const NOT_PROJECTS = new Set(["UTF", "ISO", "COVID", "SHA", "MD", "RFC", "CVE", "DIN", "EN", "PDF", "HTTP", "TLS", "SSL", "WIN", "X"]);

const safeAll = <T>(sql: string, ...args: unknown[]): T[] => {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};

/** The people and tickets of the texts the indexer reads — built once per run (the people and the known projects read once). */
export type Resolver = {
  people: Person[];
  /** The people a text and its senders (names, addresses, Jira usernames, chat names) concern. */
  peopleIn: (text: string, ...senders: (string | null | undefined)[]) => number[];
  /** One sender (an address or a name) as a person; null: not one we know (or two have that name). */
  person: (who: string | null | undefined) => number | null;
  /** The ticket keys in a text. */
  tickets: (text: string | null | undefined) => string[];
};

export function makeResolver(): Resolver {
  let people: Person[] = [];
  try {
    people = listPeople();
  } catch {
    people = [];
  }
  const byName = new Map<string, number>();
  const clash = new Set<string>();
  const put = (k: string, id: number) => {
    const key = k.trim().toLowerCase();
    if (key.length < 2) return;
    if (byName.has(key) && byName.get(key) !== id) clash.add(key);
    byName.set(key, id);
  };
  for (const p of people) {
    for (const n of namesOf(p)) put(n, p.id);
    for (const e of p.emails) put(e, p.id);
    for (const a of p.accounts) put(a.value, p.id);
  }
  for (const k of clash) byName.delete(k);
  const addresses = people.flatMap((p) => p.emails.map((e) => [e.toLowerCase(), p.id] as const));
  const matcher = mentionMatcher(buildPeopleIndex(people));
  const person = (who: string | null | undefined): number | null => {
    const w = String(who ?? "").trim().toLowerCase();
    if (!w) return null;
    return byName.get(w) ?? byName.get(w.replace(/^.*<([^>]+)>.*$/, "$1")) ?? null;
  };
  const projects = new Set<string>();
  for (const r of safeAll<{ key: string }>("select key from jira_tickets union select ticket key from jira_comments union select distinct ticket key from todos")) {
    const m = /^([A-Z][A-Z0-9]+)-\d+$/i.exec(r.key ?? "");
    if (m) projects.add(m[1].toUpperCase());
  }
  projects.add("WS").add("KB");
  const tickets = (text: string | null | undefined): string[] => {
    const out = new Set<string>();
    for (const k of String(text ?? "").match(KEY) ?? []) {
      const project = k.split("-")[0];
      if (!isTicketKey(k)) continue;
      if (projects.size > 2 ? projects.has(project) : !NOT_PROJECTS.has(project)) out.add(k.toUpperCase());
    }
    return [...out];
  };
  const peopleIn = (text: string, ...senders: (string | null | undefined)[]): number[] => {
    const ids = new Set<number>();
    for (const m of splitMentions(text, matcher)) if (m.person) ids.add(m.person.id);
    const lower = text.toLowerCase();
    for (const [e, id] of addresses) if (lower.includes(e)) ids.add(id);
    for (const s of senders) {
      const id = person(s);
      if (id) ids.add(id);
    }
    return [...ids];
  };
  return { people, peopleIn, person, tickets };
}

/** The refs a ref names, as kinds the timeline knows. */
const REF = /^(person|org|place|ticket|page|project|job|todo|doc|event|entry|mail|msg):\S/;

/**
 * What a free text means as a ref: a ref itself ("person:12"), a ticket key, a person (their name, an alias, their address, or a
 * part of their name only they have), a project, a job number, a Workspace page by its title. null: nothing fits.
 */
export function resolveQuery(q: string): { ref: string; label: string } | null {
  const text = String(q ?? "").trim();
  if (!text) return null;
  if (REF.test(text)) {
    const ref = normRef(text);
    return ref ? { ref, label: labelOf(ref) } : null;
  }
  if (isTicketKey(text)) return { ref: `ticket:${text.toUpperCase()}`, label: labelOf(`ticket:${text.toUpperCase()}`) };
  const lower = text.toLowerCase();
  const r = makeResolver();
  const exact = r.person(text);
  if (exact) return { ref: `person:${exact}`, label: labelOf(`person:${exact}`) };
  const index = buildPeopleIndex(r.people);
  const part = index.filter((p) => p.forms.some((f) => f.toLowerCase() === lower));
  if (part.length === 1) return { ref: `person:${part[0].id}`, label: part[0].name };
  const project = safeAll<{ id: number; title: string }>("select id, title from projects where lower(title) = ?", lower)[0];
  if (project) return { ref: `project:${project.id}`, label: project.title };
  const job = safeAll<{ number: string; name: string }>("select number, name from jobs where lower(number) = ? or lower(name) = ?", lower, lower)[0];
  if (job) return { ref: `job:${job.number}`, label: `${job.number} ${job.name}` };
  const page = safeAll<{ id: number; title: string }>("select id, title from ws_pages where archived_at is null and lower(title) = ? order by db_id is null, id limit 1", lower)[0];
  if (page) return { ref: `page:${page.id}`, label: page.title };
  // A name that contains the text, when only one does ("Laura S").
  const loose = r.people.filter((p) => namesOf(p).some((n) => n.toLowerCase().includes(lower)));
  if (lower.length >= 3 && loose.length === 1) return { ref: `person:${loose[0].id}`, label: loose[0].name };
  return null;
}

/** A ref as people read it: a person's name, a ticket's key and summary, a page's title … — the ref itself when it is gone. */
export function labelOf(ref: string): string {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  const one = <T>(sql: string, ...args: unknown[]) => safeAll<T>(sql, ...args)[0];
  switch (kind) {
    case "person":
      return one<{ name: string }>("select name from people where id = ?", Number(id))?.name ?? ref;
    case "ticket": {
      const t = one<{ summary: string }>("select summary from jira_tickets where key = ?", id);
      return t?.summary ? `${id} ${t.summary}` : id;
    }
    case "page": {
      const p = one<{ title: string; icon: string }>("select title, icon from ws_pages where id = ?", Number(id));
      return p ? `${p.icon ? `${p.icon} ` : ""}${p.title || "Untitled"}` : ref;
    }
    case "project":
      return one<{ title: string }>("select title from projects where id = ?", Number(id))?.title ?? ref;
    case "job": {
      const j = one<{ name: string }>("select name from jobs where number = ?", id);
      return j ? `${id} ${j.name}` : id;
    }
    case "todo": {
      const t = one<{ text: string }>("select text from todos where id = ?", Number(id));
      return t ? `T-${id} ${t.text.slice(0, 80)}` : `T-${id}`;
    }
    case "doc":
      return one<{ name: string }>("select name from documents where id = ?", Number(id))?.name ?? ref;
    case "event":
      return one<{ title: string }>("select title from calendar_events where id = ?", Number(id))?.title ?? ref;
    default:
      return ref;
  }
}

/** Where a ref opens in Zeff ("" when nowhere). */
export function hrefOf(ref: string): string {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (kind === "page") return `/workspace/${id}`;
  if (kind === "todo") return `/t/${id}`;
  if (kind === "ticket") return `/tickets?ticket=${encodeURIComponent(id)}`;
  if (kind === "person") {
    const row = safeAll<{ id: number }>("select id from ws_pages where archived_at is null and json_extract(props, '$.srcref') = ? limit 1", ref)[0];
    return row ? `/workspace/${row.id}` : `/personen`;
  }
  if (kind === "doc") return `/api/documents/${id}/file`;
  if (kind === "entry") return `/entries/${id}`;
  if (kind === "project") return "/projects";
  return "";
}

/** The refs a Workspace row stands for: itself, the person or case it is, what its case gathered, the ticket its title names. */
export function refsOfRow(rowId: number): string[] {
  const out = new Set<string>([`page:${rowId}`]);
  const row = safeAll<{ props: string; title: string }>("select props, title from ws_pages where id = ?", rowId)[0];
  if (!row) return [...out];
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(row.props) as Record<string, unknown>;
  } catch {
    props = {};
  }
  const src = String(props.srcref ?? "");
  const person = /^person:(\d+)$/.exec(src);
  if (person) out.add(src);
  const fromRow = /^page:(\d+)$/.exec(src);
  if (fromRow && Number(fromRow[1]) !== rowId) for (const r of refsOfRow(Number(fromRow[1]))) out.add(r);
  const kase = /^case:(\d+)$/.exec(src);
  if (kase) {
    for (const s of safeAll<{ ref: string }>("select ref from case_sources where case_id = ?", Number(kase[1]))) if (normRef(s.ref)) out.add(normRef(s.ref));
    const p = safeAll<{ person_id: number | null }>("select person_id from cases where id = ?", Number(kase[1]))[0];
    if (p?.person_id) out.add(`person:${p.person_id}`);
  }
  if (/^jira:/.test(src)) out.add(`ticket:${src.slice(5).toUpperCase()}`);
  const key = String(props.key ?? props.ticket ?? "");
  if (isTicketKey(key)) out.add(`ticket:${key.toUpperCase()}`);
  for (const k of row.title.match(KEY) ?? []) if (isTicketKey(k)) out.add(`ticket:${k.toUpperCase()}`);
  return [...out];
}
