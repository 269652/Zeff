/**
 * What the Entities plugin proposes — never applies by itself (people's identity resolution, identity.ts, for organisations,
 * places and projects): an organisation behind a mail domain, a job's customer, a profile that is a company, a bank's
 * counterparty with a legal form; a place an appointment is at, an address someone lives at or a letter names; a project for a
 * job that has a Jira board, tickets or a repo — with its job number, Jira key and board, repos and Workspace databases. Also
 * another name of one you have (an alias), a domain or link it lacks, two that are one (merge). Deterministic, no AI: only what
 * the sources carry. A proposal waits in the review queue until you accept it; a rejected one is remembered and not made again.
 * What follows from what you confirmed — who works at an organisation (their address is at its domain), who lives at a place —
 * is linked by rule (deriveEntityLinks). Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { SYSTEM_LABELS } from "@/lib/noise";
import { createProject, getProjectByTitle } from "@/lib/projects";
import { addLink } from "@/plugins/people/graph";
import { listPeople } from "@/plugins/people/store";
import { addAlias, addEntityLink, createEntity, entDb, getEntity, listEntities, mergeEntities, parseRef, type Entity, type EntityRel } from "./store";
import { domainOf, foldName, isFreemail, isOnlineLocation, looksLikeAddress, normalizeAddress, normalizeOrgName, orgNameFromDomain, registrableDomain } from "./normalize";

export type EntitySuggestionKind = "org" | "place" | "project" | "alias" | "merge" | "link";
export type SuggestedLink = { rel: EntityRel; target: string; label?: string };
export type EntitySuggestion = {
  id: number;
  kind: EntitySuggestionKind;
  /** alias, link: the entity it goes to. merge: the one that stays. A new one: "". */
  ref: string;
  /** merge: the one that goes into it. */
  otherRef: string;
  /** A new one's name; an alias. */
  name: string;
  data: { domains?: string[]; aliases?: string[]; address?: string; jobNumber?: string; customer?: string; links?: SuggestedLink[] };
  /** Why — one line, as shown in the queue. */
  evidence: string;
  confidence: number;
  createdAt: string;
};

function db() {
  const d = entDb();
  d.exec(`create table if not exists ent_suggestions (id integer primary key autoincrement, key text not null unique, kind text not null, ref text not null default '', other_ref text not null default '', name text not null default '', data text not null default '{}', evidence text not null default '', confidence real not null default 0.5, status text not null default 'pending', created_at text not null, decided_at text);`);
  return d;
}

const now = () => new Date().toISOString();
type Row = { id: number; key: string; kind: string; ref: string; other_ref: string; name: string; data: string; evidence: string; confidence: number; created_at: string };
const KINDS: readonly string[] = ["org", "place", "project", "alias", "merge", "link"];
const toSuggestion = (r: Row): EntitySuggestion => ({
  id: r.id,
  kind: (KINDS.includes(r.kind) ? r.kind : "alias") as EntitySuggestionKind,
  ref: r.ref,
  otherRef: r.other_ref,
  name: r.name,
  data: (() => {
    try {
      return JSON.parse(r.data) as EntitySuggestion["data"];
    } catch {
      return {};
    }
  })(),
  evidence: r.evidence,
  confidence: r.confidence,
  createdAt: r.created_at,
});

/** The proposals waiting, the surest first. */
export const pendingEntitySuggestions = (): EntitySuggestion[] => (db().prepare("select * from ent_suggestions where status = 'pending' order by confidence desc, id").all() as Row[]).map(toSuggestion);

type Proposal = Omit<EntitySuggestion, "id" | "createdAt"> & { key: string };

/** A proposal queued — once per key, whatever became of it; one still waiting gets the evidence of now. Whether it is new. */
function propose(s: Proposal): boolean {
  const data = JSON.stringify(s.data);
  const confidence = Math.max(0, Math.min(1, s.confidence));
  const r = db()
    .prepare("insert or ignore into ent_suggestions (key, kind, ref, other_ref, name, data, evidence, confidence, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.key, s.kind, s.ref, s.otherRef, s.name, data, s.evidence.slice(0, 300), confidence, now());
  if (!r.changes) db().prepare("update ent_suggestions set name = ?, data = ?, evidence = ?, confidence = ? where key = ? and status = 'pending'").run(s.name, data, s.evidence.slice(0, 300), confidence, s.key);
  return r.changes > 0;
}

/** Read from a table that may not be there (its plugin never ran): nothing then. */
function all<T>(sql: string, ...args: unknown[]): T[] {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

type OrgCand = { names: Map<string, number>; domains: Set<string>; evidence: string[]; confidence: number; mails: number };

/** Its best name: the one a source gave most weight (a profile's, a customer's over a domain's label). */
const bestName = (c: OrgCand) => [...c.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];

function orgCandidates(): OrgCand[] {
  const cands: OrgCand[] = [];
  const byKey = new Map<string, OrgCand>();
  const byDomain = new Map<string, OrgCand>();
  const add = (name: string, weight: number, o: { domains?: string[]; evidence: string; confidence: number; mails?: number }) => {
    const key = normalizeOrgName(name);
    if (key.length < 2) return;
    const domains = (o.domains ?? []).filter((d) => d && !isFreemail(d));
    const found = domains.map((d) => byDomain.get(d)).find(Boolean) ?? byKey.get(key);
    const c = found ?? { names: new Map<string, number>(), domains: new Set<string>(), evidence: [], confidence: 0, mails: 0 };
    if (!found) cands.push(c);
    c.names.set(name, Math.max(c.names.get(name) ?? 0, weight));
    for (const d of domains) {
      c.domains.add(d);
      byDomain.set(d, c);
    }
    byKey.set(key, c);
    if (!c.evidence.includes(o.evidence)) c.evidence.push(o.evidence);
    c.confidence = Math.max(c.confidence, o.confidence);
    c.mails += o.mails ?? 0;
  };

  // 1. Mail domains: who writes from an organisation's domain (freemail never; two mails, an address of a profile, or one you answered).
  const perDomain = new Map<string, { mails: number; addresses: Set<string>; replied: number; people: number }>();
  const replied = new Set(all<{ e: string }>("select distinct lower(o.from_email) e from emails o where o.from_email like '%@%' and exists (select 1 from emails m where m.conv_id = o.conv_id and m.from_name = 'Ich')").map((r) => r.e));
  for (const r of all<{ e: string; c: number }>("select lower(from_email) e, count(*) c from emails where from_email like '%@%' and folder not in ('WhatsApp', 'Signal') group by e")) {
    const d = domainOf(r.e);
    if (!d || isFreemail(d) || SYSTEM_LABELS.has(d.split(".")[0])) continue;
    const s = perDomain.get(d) ?? { mails: 0, addresses: new Set<string>(), replied: 0, people: 0 };
    s.mails += r.c;
    s.addresses.add(r.e);
    if (replied.has(r.e)) s.replied++;
    perDomain.set(d, s);
  }
  const people = all<{ id: number; name: string; emails: string; kind: string }>("select id, name, emails, kind from people");
  const emailsOf = (raw: string): string[] => {
    try {
      return (JSON.parse(raw) as string[]).map((e) => e.toLowerCase());
    } catch {
      return [];
    }
  };
  for (const p of people) {
    if (p.kind === "organization") continue;
    for (const d of new Set(emailsOf(p.emails).map(domainOf))) {
      if (!d || isFreemail(d) || SYSTEM_LABELS.has(d.split(".")[0])) continue;
      const s = perDomain.get(d) ?? { mails: 0, addresses: new Set<string>(), replied: 0, people: 0 };
      s.people++;
      perDomain.set(d, s);
    }
  }
  for (const [d, s] of perDomain) {
    if (s.mails < 2 && !s.people && !s.replied) continue;
    const bits = [s.mails ? `${plural(s.mails, "mail", "mails")} from ${d}` : `addresses at ${d}`];
    if (s.people) bits.push(plural(s.people, "profile has an address there", "profiles have an address there"));
    if (s.replied) bits.push("you wrote back");
    add(orgNameFromDomain(d), 1, { domains: [d], evidence: bits.join(", "), confidence: Math.min(0.95, 0.6 + Math.min(0.2, s.mails / 80) + (s.people ? 0.1 : 0) + (s.replied ? 0.1 : 0)), mails: s.mails });
  }

  // 2. People profiles that are an organisation (a bank, an authority, a company) — with their domains.
  for (const p of people.filter((x) => x.kind === "organization")) add(p.name, 3, { domains: [...new Set(emailsOf(p.emails).map(domainOf))], evidence: `${p.name} is a profile of an organisation in People`, confidence: 0.95 });

  // 3. The customers of jobs and projects.
  for (const j of all<{ number: string; customer: string | null; chrono_client: string | null }>("select number, customer, chrono_client from jobs where number != 'NO-JOB'")) {
    for (const c of [j.customer, j.chrono_client?.split("·")[0]]) if (c?.trim()) add(c.trim(), 2, { evidence: `customer of job ${j.number}`, confidence: 0.85 });
  }
  for (const p of all<{ title: string; customer: string | null }>("select title, customer from projects where customer is not null and customer != ''")) add(p.customer!.trim(), 2, { evidence: `customer of the project ${p.title}`, confidence: 0.85 });

  // 4. Bank counterparties with a legal form (a company, a bank, an insurance — not a pocket or a friend).
  const LEGAL = /\b(?:GmbH|AG|SE|KG|KGaA|OHG|UG|e\.\s?V\.|Inc|Ltd|LLC|Bank|Sparkasse|Volksbank|Versicherung|Stadtwerke|Krankenkasse|Kasse|Finanzamt|Amt)\b/;
  for (const b of all<{ counterparty: string; n: number }>("select counterparty, count(*) n from bank_transactions where counterparty != '' group by counterparty")) {
    if (LEGAL.test(b.counterparty)) add(b.counterparty.trim(), 2, { evidence: `${plural(b.n, "payment", "payments")} with ${b.counterparty}`, confidence: 0.7 });
  }

  // 5. What people's roles name: "Entwicklerin bei Contoso", "PM at Fabrikam" ("für"/"for" names products as often).
  const AT = /\b(?:bei|at)\s+(?:der |dem |the )?(\p{Lu}[\p{L}\d&\-]+(?:\s+(?:\p{Lu}[\p{L}\d&\-]+|GmbH|AG|SE|&))*)/u;
  for (const c of all<{ text: string; name: string }>("select c.text, p.name from people_claims c join people p on p.id = c.person_id where c.kind = 'role' and c.status != 'rejected'")) {
    const m = AT.exec(c.text);
    if (m) add(m[1].trim(), 1, { evidence: `${c.name}: “${c.text.slice(0, 80)}”`, confidence: 0.6 });
  }
  return cands;
}

/** Every way an organisation is written, as compared. */
const orgForms = (o: Entity) => new Set([o.name, ...o.aliases].map(normalizeOrgName).filter(Boolean));

function findOrgSuggestions(q: (p: Proposal, wanted?: boolean) => void): void {
  const orgs = listEntities("org");
  // 1. Two organisations that are one: a domain, or a name written the same.
  for (let i = 0; i < orgs.length; i++) {
    for (let j = i + 1; j < orgs.length; j++) {
      const a = orgs[i];
      const b = orgs[j];
      const domain = a.domains.find((d) => b.domains.includes(d));
      const fa = orgForms(a);
      const name = [...orgForms(b)].find((f) => fa.has(f));
      if (!domain && !name) continue;
      const [keep, drop] = [a, b].sort((x, y) => y.domains.length + y.aliases.length - (x.domains.length + x.aliases.length) || x.id - y.id);
      q({ key: `merge:${a.ref}:${b.ref}`, kind: "merge", ref: keep.ref, otherRef: drop.ref, name: drop.name, data: {}, evidence: domain ? `both have the domain ${domain}` : `“${a.name}” and “${b.name}” are the same name`, confidence: domain ? 0.95 : 0.85 });
    }
  }
  const byDomain = new Map(orgs.flatMap((o) => o.domains.map((d) => [d, o] as const)));
  const byForm = new Map<string, Entity>();
  for (const o of orgs) for (const f of orgForms(o)) byForm.set(f, o);
  // 2. What the sources call organisations.
  for (const c of orgCandidates()) {
    const viaDomain = [...c.domains].map((d) => byDomain.get(d)).find(Boolean);
    const viaName = [...c.names.keys()].map((n) => byForm.get(normalizeOrgName(n))).find(Boolean);
    const org = viaDomain ?? viaName;
    const evidence = c.evidence.join("; ");
    if (org) {
      const forms = orgForms(org);
      for (const [name] of c.names) {
        const key = normalizeOrgName(name);
        if (forms.has(key) || byForm.get(key)) continue;
        q({ key: `alias:${org.ref}:${key}`, kind: "alias", ref: org.ref, otherRef: "", name, data: {}, evidence: viaDomain ? `${evidence} — ${org.name}'s domain` : evidence, confidence: viaDomain ? 0.85 : 0.7 });
      }
      const missing = [...c.domains].filter((d) => !byDomain.has(d));
      if (missing.length) q({ key: `link:${org.ref}:domain:${missing.sort().join(",")}`, kind: "link", ref: org.ref, otherRef: "", name: org.name, data: { links: missing.map((d) => ({ rel: "domain" as const, target: d })) }, evidence, confidence: Math.max(0.6, c.confidence - 0.1) }, true);
      continue;
    }
    const name = bestName(c);
    const aliases = [...c.names.keys()].filter((n) => n !== name && normalizeOrgName(n) !== normalizeOrgName(name));
    q({ key: `org:${normalizeOrgName(name)}`, kind: "org", ref: "", otherRef: "", name, data: { domains: [...c.domains].sort(), ...(aliases.length ? { aliases } : {}) }, evidence, confidence: c.confidence }, true);
  }
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

type PlaceCand = { key: string; display: Map<string, number>; count: number; evidence: string[]; confidence: number; strong: boolean };

function placeCandidates(): PlaceCand[] {
  const byKey = new Map<string, PlaceCand>();
  const add = (text: string, o: { count?: number; evidence: string; confidence: number; strong: boolean }) => {
    const display = text.replace(/\s+/g, " ").replace(/ ,/g, ",").trim();
    const key = normalizeAddress(display);
    if (key.length < 3 || isOnlineLocation(display)) return;
    const c = byKey.get(key) ?? { key, display: new Map<string, number>(), count: 0, evidence: [], confidence: 0, strong: false };
    c.display.set(display, (c.display.get(display) ?? 0) + (o.count ?? 1));
    c.count += o.count ?? 1;
    if (!c.evidence.includes(o.evidence)) c.evidence.push(o.evidence);
    c.confidence = Math.max(c.confidence, o.confidence);
    c.strong ||= o.strong;
    byKey.set(key, c);
  };
  // Where appointments are (calls and links are no place).
  for (const e of all<{ location: string; n: number }>("select location, count(*) n from calendar_events where location != '' and cancelled = 0 group by location")) {
    const postcode = /\b\d{4,5}\b/.test(e.location);
    add(e.location, { count: e.n, evidence: `${plural(e.n, "appointment", "appointments")} at ${e.location}`, confidence: postcode ? 0.75 : 0.6, strong: postcode && looksLikeAddress(e.location) });
  }
  // People's addresses.
  for (const r of all<{ value: string; name: string }>("select d.value, p.name from people_details d join people p on p.id = d.person_id where d.key = 'address' and d.removed = 0")) add(r.value, { evidence: `${r.name}'s address`, confidence: 0.9, strong: true });
  // The addresses letters name (the latest documents).
  const ADDRESS = /([\p{Lu}][\p{L}\-]*?(?:[Ss]tra(?:ß|ss)e|[Ss]tr\.|[Ww]eg|[Pp]latz|[Aa]llee|[Gg]asse|[Rr]ing|[Dd]amm|[Uu]fer|[Mm]arkt) \d+ ?[a-zA-Z]?),? (\d{5}) ([\p{Lu}][\p{L}\-]*)/gu;
  for (const doc of all<{ name: string; text: string }>("select name, text from documents where status = 'ready' order by id desc limit 300")) {
    for (const m of new Set([...doc.text.matchAll(ADDRESS)].map((x) => `${x[1]}, ${x[2]} ${x[3]}`))) add(m, { evidence: `in the document ${doc.name}`, confidence: 0.7, strong: true });
  }
  return [...byKey.values()];
}

const placeForms = (p: Entity) => new Set([p.name, ...p.aliases, p.address].filter(Boolean).map(normalizeAddress));
/** A shorter way of writing an address: "hauptstrasse 3" of "hauptstrasse 3 10115 berlin". */
const shortOf = (short: string, long: string) => long.length > short.length && long.startsWith(short + " ");

function findPlaceSuggestions(q: (p: Proposal, wanted?: boolean) => void): void {
  const places = listEntities("place");
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const fa = placeForms(places[i]);
      const same = [...placeForms(places[j])].find((f) => fa.has(f));
      if (same) q({ key: `merge:${places[i].ref}:${places[j].ref}`, kind: "merge", ref: places[i].ref, otherRef: places[j].ref, name: places[j].name, data: {}, evidence: `both are ${same}`, confidence: 0.9 });
    }
  }
  const cands = placeCandidates();
  for (const c of cands) {
    const display = [...c.display.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    const evidence = c.evidence.slice(0, 4).join("; ");
    if (places.some((p) => placeForms(p).has(c.key))) continue;
    // A shorter way of writing a place you have: another name of it.
    const longer = places.filter((p) => [...placeForms(p)].some((f) => shortOf(c.key, f)));
    if (longer.length === 1) {
      q({ key: `alias:${longer[0].ref}:${c.key}`, kind: "alias", ref: longer[0].ref, otherRef: "", name: display, data: {}, evidence: `${evidence} — reads like ${longer[0].name}`, confidence: 0.75 });
      continue;
    }
    // … of one still to be confirmed: it waits for that one.
    if (cands.some((o) => shortOf(c.key, o.key))) continue;
    if (!c.strong && c.count < 2) continue;
    q({ key: `place:${c.key}`, kind: "place", ref: "", otherRef: "", name: display, data: { address: display }, evidence, confidence: c.confidence }, true);
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function findProjectSuggestions(q: (p: Proposal, wanted?: boolean) => void): void {
  const jobs = all<{ id: number; number: string; name: string; customer: string | null; active: number }>("select id, number, name, customer, active from jobs where number != 'NO-JOB'");
  const boards = all<{ id: number; name: string; project_key: string | null; job_number: string | null }>("select id, name, project_key, job_number from jira_boards");
  const repos = all<{ id: number; name: string; boards: string }>("select id, name, boards from repos");
  const boardDbs = new Map(all<{ board_id: string; db_id: number }>("select board_id, db_id from jira_board_dbs").map((r) => [r.board_id, r.db_id]));
  const dbs = all<{ id: number; title: string }>("select id, title from ws_pages where kind = 'database' and archived_at is null");
  const ticketKeys = new Map<string, Map<string, number>>();
  for (const t of all<{ job_number: string; k: string; n: number }>("select job_number, substr(key, 1, instr(key, '-') - 1) k, count(*) n from jira_tickets where job_number is not null and job_number != '' group by job_number, k")) {
    const m = ticketKeys.get(t.job_number) ?? new Map<string, number>();
    m.set(t.k, t.n);
    ticketKeys.set(t.job_number, m);
  }
  const boardsOf = (r: { boards: string }): number[] => {
    try {
      return (JSON.parse(r.boards) as unknown[]).map(Number);
    } catch {
      return [];
    }
  };
  const projects = listEntities("project");
  const orgs = listEntities("org");
  const orgByForm = new Map<string, Entity>();
  for (const o of orgs) for (const f of orgForms(o)) orgByForm.set(f, o);

  /** What belongs to a job by the sources: its boards (their key, their database), the repos of those boards, the tickets booked on it, databases named like it. */
  const linksForJob = (job: (typeof jobs)[number], title: string): { links: SuggestedLink[]; why: string[] } => {
    const links: SuggestedLink[] = [{ rel: "job", target: job.number, label: job.name }];
    const why: string[] = [];
    const mine = boards.filter((b) => b.job_number === job.number);
    for (const b of mine) {
      links.push({ rel: "board", target: String(b.id), label: b.name });
      if (b.project_key) links.push({ rel: "jira", target: b.project_key.toUpperCase() });
      const dbId = boardDbs.get(`jira-${b.id}`);
      if (dbId) links.push({ rel: "db", target: String(dbId), label: b.name });
    }
    if (mine.length) why.push(`Jira board ${mine.map((b) => b.name).join(", ")} books on ${job.number}`);
    for (const [k, n] of ticketKeys.get(job.number) ?? []) {
      links.push({ rel: "jira", target: k.toUpperCase() });
      why.push(`${plural(n, "ticket", "tickets")} ${k}-… on ${job.number}`);
    }
    const boardIds = new Set(mine.map((b) => b.id));
    for (const r of repos.filter((x) => boardsOf(x).some((b) => boardIds.has(b)))) {
      links.push({ rel: "repo", target: String(r.id), label: r.name });
      why.push(`repo ${r.name} works on the board`);
    }
    const names = new Set([foldName(title), foldName(job.name)]);
    for (const d of dbs.filter((x) => names.has(foldName(x.title)))) links.push({ rel: "db", target: String(d.id), label: d.title });
    const org = job.customer ? orgByForm.get(normalizeOrgName(job.customer)) : undefined;
    if (org) links.push({ rel: "org", target: org.ref, label: org.name });
    const seen = new Set<string>();
    return { links: links.filter((l) => (seen.has(`${l.rel}:${l.target}`) ? false : (seen.add(`${l.rel}:${l.target}`), true))), why };
  };

  const projectOfJob = (number: string) => projects.find((p) => p.address === number) ?? projects.find((p) => all<{ ref: string }>("select ref from ent_links where ref = ? and rel = 'job' and target = ?", p.ref, number).length);
  for (const job of jobs) {
    const project = projectOfJob(job.number);
    const { links, why } = linksForJob(job, project?.name ?? job.name);
    if (project) {
      const have = new Set(all<{ rel: string; target: string }>("select rel, target from ent_links where ref = ?", project.ref).map((l) => `${l.rel}:${l.target}`));
      const missing = links.filter((l) => !have.has(`${l.rel}:${l.target}`) && !(l.rel === "job" && project.address === l.target));
      if (missing.length) q({ key: `link:${project.ref}:${missing.map((l) => `${l.rel}=${l.target}`).sort().join(",")}`, kind: "link", ref: project.ref, otherRef: "", name: project.name, data: { links: missing }, evidence: why.join("; ") || `job ${job.number}`, confidence: 0.85 }, true);
      continue;
    }
    // A job with nothing beyond its entries (meetings, training, absences) is no project.
    if (!why.length || !job.active) continue;
    q({ key: `project:${job.number}`, kind: "project", ref: "", otherRef: "", name: job.name, data: { jobNumber: job.number, ...(job.customer ? { customer: job.customer } : {}), links }, evidence: why.join("; "), confidence: 0.85 }, true);
  }
  // Projects without a job: a Workspace database of the same name.
  for (const p of projects.filter((x) => !x.address)) {
    const have = new Set(all<{ target: string }>("select target from ent_links where ref = ? and rel = 'db'", p.ref).map((l) => l.target));
    const missing = dbs.filter((d) => foldName(d.title) === foldName(p.name) && !have.has(String(d.id))).map((d) => ({ rel: "db" as const, target: String(d.id), label: d.title }));
    if (missing.length) q({ key: `link:${p.ref}:${missing.map((l) => `db=${l.target}`).join(",")}`, kind: "link", ref: p.ref, otherRef: "", name: p.name, data: { links: missing }, evidence: `the database “${missing[0].label}” has its name`, confidence: 0.7 }, true);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Look for organisations, places and projects to propose, other names and links of the ones you have, and ones that are the same.
 * How many were queued. The waiting proposals to create or link something this run no longer makes (the thing exists now, the
 * source is gone) go out of the queue.
 */
export function findEntitySuggestions(): number {
  let queued = 0;
  const wanted = new Set<string>();
  const q = (p: Proposal, track = false) => {
    if (track) wanted.add(p.key);
    if (propose(p)) queued++;
  };
  findOrgSuggestions(q);
  findPlaceSuggestions(q);
  findProjectSuggestions(q);
  const stale = (db().prepare("select key from ent_suggestions where status = 'pending' and kind in ('org', 'place', 'project', 'link')").all() as { key: string }[]).filter((r) => !wanted.has(r.key));
  for (const r of stale) db().prepare("update ent_suggestions set status = 'obsolete', decided_at = ? where key = ?").run(now(), r.key);
  if (queued || stale.length) emitChange("todos");
  return queued;
}

/** Accept a proposal: do what it says. The entity it made or changed (its ref); undefined when it waits no more. Throws when it no longer fits. */
export function acceptEntitySuggestion(id: number): string | undefined {
  const r = db().prepare("select * from ent_suggestions where id = ? and status = 'pending'").get(id) as Row | undefined;
  if (!r) return undefined;
  const s = toSuggestion(r);
  let ref: string;
  const linkAll = (to: string, links: SuggestedLink[] = []) => {
    for (const l of links) addEntityLink(to, l.rel, l.target, { label: l.label, evidence: s.evidence, source: "suggestion" });
  };
  if (s.kind === "org") {
    ref = `org:${createEntity("org", s.name)}`;
    for (const d of s.data.domains ?? []) addEntityLink(ref, "domain", registrableDomain(d), { evidence: s.evidence, source: "suggestion" });
    for (const a of s.data.aliases ?? []) addAlias(ref, a);
  } else if (s.kind === "place") {
    ref = `place:${createEntity("place", s.name, { address: s.data.address ?? s.name })}`;
    for (const a of s.data.aliases ?? []) addAlias(ref, a);
  } else if (s.kind === "project") {
    ref = createProjectFor(s);
  } else if (s.kind === "merge") {
    mergeEntities(s.ref, s.otherRef);
    ref = s.ref;
  } else {
    if (!getEntity(s.ref)) throw new Error("Unknown entity.");
    ref = s.ref;
    if (s.kind === "alias") addAlias(ref, s.name);
    else linkAll(ref, s.data.links);
  }
  db().prepare("update ent_suggestions set status = 'accepted', decided_at = ? where id = ?").run(now(), id);
  // Others that concern an entity that is gone now.
  for (const o of pendingEntitySuggestions()) if ([o.ref, o.otherRef].some((x) => x && parseRef(x) && !getEntity(x))) db().prepare("update ent_suggestions set status = 'obsolete', decided_at = ? where id = ?").run(now(), o.id);
  emitChange("todos");
  return ref;

  function createProjectFor(p: EntitySuggestion): string {
    const title = getProjectByTitle(p.name) ? `${p.name} (${p.data.jobNumber})` : p.name;
    const made = createProject({ title, jobNumber: p.data.jobNumber, ...(p.data.customer ? { customer: p.data.customer } : {}) });
    const to = `project:${made.id}`;
    linkAll(to, (p.data.links ?? []).filter((l) => !(l.rel === "job" && l.target === p.data.jobNumber)));
    return to;
  }
}

export function rejectEntitySuggestion(id: number): void {
  db().prepare("update ent_suggestions set status = 'rejected', decided_at = ? where id = ? and status = 'pending'").run(now(), id);
  emitChange("todos");
}

// ---------------------------------------------------------------------------
// Links by rule, from what you confirmed
// ---------------------------------------------------------------------------

/**
 * Who works at an organisation (an address of theirs at its domain; a role of theirs that names it) and who lives or sits at a
 * place (their address is it): links of the people graph from the "rule" source, confirmed — seen again each run, they stay;
 * one not seen for 90 days lapses (graph.ts). How many were new.
 */
export function deriveEntityLinks(): number {
  let added = 0;
  let people: ReturnType<typeof listPeople>;
  try {
    people = listPeople();
  } catch {
    return 0;
  }
  const orgs = listEntities("org");
  const byDomain = new Map(orgs.flatMap((o) => o.domains.map((d) => [d, o] as const)));
  const link = (personId: number, rel: "works-at" | "located-at", e: Entity, evidence: string) => {
    if (addLink({ personId, rel, targetType: e.kind === "org" ? "org" : "place", targetRef: String(e.id), label: e.name, evidence, source: "rule", sourceRef: e.ref, confidence: 0.95, status: "confirmed" })) added++;
  };
  for (const p of people) {
    if (p.kind === "organization") continue;
    for (const email of p.emails) {
      const d = domainOf(email);
      const org = d && !isFreemail(d) ? byDomain.get(d) : undefined;
      if (org) link(p.id, "works-at", org, `their address ${email}`);
    }
  }
  // A role that names the organisation ("Entwicklerin bei Contoso") — confirmed, or one the AI is sure of.
  const forms = orgs.flatMap((o) => [...orgForms(o)].filter((f) => f.length >= 3).map((f) => [f, o] as const));
  for (const c of all<{ person_id: number; text: string }>("select person_id, text from people_claims where kind = 'role' and status != 'rejected' and (status = 'confirmed' or confidence >= 0.8)")) {
    const words = ` ${normalizeOrgName(c.text)} `;
    const hit = forms.find(([f]) => words.includes(` ${f} `));
    if (hit) link(c.person_id, "works-at", hit[1], `“${c.text.slice(0, 120)}”`);
  }
  const places = listEntities("place");
  for (const r of all<{ person_id: number; value: string }>("select person_id, value from people_details where key = 'address' and removed = 0")) {
    const key = normalizeAddress(r.value);
    const place = places.find((p) => placeForms(p).has(key));
    if (place) link(r.person_id, "located-at", place, `their address ${r.value}`);
  }
  return added;
}
