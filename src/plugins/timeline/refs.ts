/**
 * Who and what an event concerns, by rule (the Timeline plugin) — no AI: people by their mail address, their name, an alias, their
 * chat's name or their Jira username (a form two people share names neither), and by the names a text mentions; ticket keys in a
 * text (of the projects Zeff knows). And the other way round: a free text an agent or you give ("Laura", "PROJ-12", "Relaunch") as
 * the ref it means, and a ref's label for the pages. Server only.
 */
import { getSqlite } from "@/db";
import { isTicketKey } from "@/lib/ticket-keys";
import { buildPeopleIndex } from "@/plugins/people/mentions";
import { makePersonResolver, type PersonResolver } from "@/plugins/people/resolve";
import { namesOf } from "@/plugins/people/store";
import * as normalize from "@/plugins/entities/normalize";
import { projectOf } from "@/plugins/entities/resolve";
import { listEntities } from "@/plugins/entities/store";
import { isInstalled } from "@/plugins/state";
import { normRef } from "./store";
import { peopleHome } from "@/plugins/workspace/people-database";

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

/**
 * The people and tickets of the texts the indexer reads — built once per run (the people and the known projects read once). The
 * people part is the People plugin's one resolver (people/resolve.ts: addresses, names, chats, numbers, Jira users, IBANs).
 */
export type Resolver = PersonResolver & {
  /** The ticket keys in a text. */
  tickets: (text: string | null | undefined) => string[];
  /** The organisations, places and projects (the Entities plugin's — none without it) an event's parts are. */
  entities: EntityRefs;
};

export type EntityRefs = {
  /** A mail address's organisation (by its domain — never a freemail one). */
  ofAddress: (email: string | null | undefined) => string[];
  /** A location's place (by its name, another name or its address). */
  ofPlace: (location: string | null | undefined) => string[];
  /** A ticket's project. */
  ofTicket: (key: string) => string[];
};

/** The entities' refs, read once when first asked (organisations by domain, places by address, a ticket's project kept). */
function entityRefs(): EntityRefs {
  let built: { orgs: Map<string, string[]>; places: Map<string, string[]>; tickets: Map<string, string[]> } | null = null;
  let mod: { n: typeof normalize; r: { projectOf: typeof projectOf } } | null = null;
  const on = () => {
    if (built) return built;
    built = { orgs: new Map(), places: new Map(), tickets: new Map() };
    try {
      if (!isInstalled("entities")) return built;
      mod = { n: normalize, r: { projectOf } };
      const add = (m: Map<string, string[]>, k: string, ref: string) => k && m.set(k, [...new Set([...(m.get(k) ?? []), ref])]);
      for (const o of listEntities("org")) for (const d of o.domains) add(built.orgs, d.toLowerCase(), o.ref);
      for (const p of listEntities("place")) for (const a of [p.name, ...p.aliases, p.address].filter(Boolean)) add(built.places, mod.n.normalizeAddress(a), p.ref);
    } catch {
      // the entities can't be read: none
    }
    return built;
  };
  return {
    ofAddress: (email) => {
      const b = on();
      if (!mod || !email || !email.includes("@")) return [];
      const d = mod.n.registrableDomain(mod.n.domainOf(email.toLowerCase()));
      return d && !mod.n.isFreemail(d) ? (b.orgs.get(d) ?? []) : [];
    },
    ofPlace: (location) => {
      const b = on();
      if (!mod || !location?.trim() || mod.n.isOnlineLocation(location)) return [];
      return b.places.get(mod.n.normalizeAddress(location)) ?? [];
    },
    ofTicket: (key) => {
      const b = on();
      if (!mod) return [];
      if (!b.tickets.has(key)) {
        let p: string | null = null;
        try {
          p = mod.r.projectOf(`ticket:${key}`);
        } catch {
          p = null;
        }
        b.tickets.set(key, p ? [p] : []);
      }
      return b.tickets.get(key)!;
    },
  };
}

export function makeResolver(): Resolver {
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
  return { ...makePersonResolver(), tickets, entities: entityRefs() };
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
  if (kind === "ticket") return `/todos?part=tickets&ticket=${encodeURIComponent(id)}`;
  if (kind === "person") {
    const row = safeAll<{ id: number }>("select id from ws_pages where archived_at is null and json_extract(props, '$.srcref') = ? limit 1", ref)[0];
    return row ? `/workspace/${row.id}` : peopleHome();
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
  // A contract's row (the Finances plugin's recurring payments): its payments.
  if (/^recurring:./.test(src)) out.add(src);
  const key = String(props.key ?? props.ticket ?? "");
  if (isTicketKey(key)) out.add(`ticket:${key.toUpperCase()}`);
  for (const k of row.title.match(KEY) ?? []) if (isTicketKey(k)) out.add(`ticket:${k.toUpperCase()}`);
  return [...out];
}
