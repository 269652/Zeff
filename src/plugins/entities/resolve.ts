/**
 * The resolver (the Entities plugin): which known things a text, an address or a domain means — people, organisations, places,
 * projects, as refs ("person:4", "org:2", "place:7", "project:3") — and `projectOf`, the one project a time entry, a ticket, a
 * job, a repo, a merge request, a todo or a Workspace row belongs to. What other parts read to tie their records to the same
 * thing (the timeline's indexer, open loops, a todo's context). Deterministic, no AI; see docs/entities.md. Server only.
 */
import { getSqlite } from "@/db";
import { normalizeName } from "@/plugins/people/accounts";
import { listPeople, namesOf } from "@/plugins/people/store";
import { domainOf, foldName, isFreemail, normalizeAddress, normalizeOrgName, registrableDomain } from "./normalize";
import { entDb, listEntities, type Entity, type EntityKind } from "./store";

export type EntityMatch = { ref: string; kind: EntityKind | "person"; name: string; /** How it was found: "email", "domain", "name", "alias", "address", "ticket", "job", "key". */ via: string };

function all<T>(sql: string, ...args: unknown[]): T[] {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^@?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const TICKET = /^[A-Z][A-Z0-9]+-\d+$/;

function orgsByDomain(domain: string): Entity[] {
  const d = registrableDomain(domain);
  if (!d || isFreemail(d)) return [];
  return listEntities("org").filter((o) => o.domains.includes(d));
}

function peopleSafe() {
  try {
    return listPeople();
  } catch {
    return [];
  }
}

/**
 * Who or what a text, an address or a domain is: an address → its person (by their addresses) and the organisation of its domain
 * (never a freemail one); a domain → its organisation; a ticket key or a job number → its project; any other text → people by
 * their names, organisations by their names (legal forms left out), places by their names or addresses, projects by their title,
 * other names, Jira key or job number. Exact matches only (as normalized) — a guess is no resolution. Each ref once.
 */
export function resolveEntity(input: string): EntityMatch[] {
  const s = String(input ?? "").trim();
  if (!s) return [];
  const out: EntityMatch[] = [];
  const add = (m: EntityMatch) => {
    if (!out.some((x) => x.ref === m.ref)) out.push(m);
  };
  if (EMAIL.test(s)) {
    const email = s.toLowerCase();
    for (const p of peopleSafe()) if (p.emails.some((e) => e.toLowerCase() === email)) add({ ref: `person:${p.id}`, kind: "person", name: p.name, via: "email" });
    for (const o of orgsByDomain(domainOf(email))) add({ ref: o.ref, kind: "org", name: o.name, via: "domain" });
    return out;
  }
  if (DOMAIN.test(s) && !/\s/.test(s) && /\.[a-z]{2,}$/i.test(s)) {
    for (const o of orgsByDomain(s.replace(/^@/, ""))) add({ ref: o.ref, kind: "org", name: o.name, via: "domain" });
    if (out.length) return out;
  }
  if (TICKET.test(s)) {
    const p = projectOf(`ticket:${s}`);
    if (p) add({ ref: p, kind: "project", name: listEntities("project").find((x) => x.ref === p)?.name ?? p, via: "ticket" });
    return out;
  }
  const folded = foldName(s);
  const person = normalizeName(s);
  for (const p of peopleSafe()) if (namesOf(p).some((n) => normalizeName(n) === person)) add({ ref: `person:${p.id}`, kind: "person", name: p.name, via: "name" });
  const orgKey = normalizeOrgName(s);
  for (const o of listEntities("org")) {
    if (normalizeOrgName(o.name) === orgKey) add({ ref: o.ref, kind: "org", name: o.name, via: "name" });
    else if (o.aliases.some((a) => normalizeOrgName(a) === orgKey)) add({ ref: o.ref, kind: "org", name: o.name, via: "alias" });
  }
  const addressKey = normalizeAddress(s);
  for (const p of listEntities("place")) {
    if (normalizeAddress(p.name) === addressKey) add({ ref: p.ref, kind: "place", name: p.name, via: "name" });
    else if (p.aliases.some((a) => normalizeAddress(a) === addressKey)) add({ ref: p.ref, kind: "place", name: p.name, via: "alias" });
    else if (p.address && normalizeAddress(p.address) === addressKey) add({ ref: p.ref, kind: "place", name: p.name, via: "address" });
  }
  const upper = s.toUpperCase();
  for (const p of listEntities("project")) {
    if (foldName(p.name) === folded) add({ ref: p.ref, kind: "project", name: p.name, via: "name" });
    else if (p.aliases.some((a) => foldName(a) === folded)) add({ ref: p.ref, kind: "project", name: p.name, via: "alias" });
    else if (p.address && p.address.toUpperCase() === upper) add({ ref: p.ref, kind: "project", name: p.name, via: "job" });
  }
  if (!out.some((m) => m.kind === "project")) {
    const viaJob = projectOf(`job:${s}`);
    if (viaJob) add({ ref: viaJob, kind: "project", name: listEntities("project").find((x) => x.ref === viaJob)?.name ?? viaJob, via: "job" });
    else if (/^[A-Z][A-Z0-9]+$/.test(s)) {
      const keyed = projectsWith("jira", upper);
      if (keyed.length === 1) add({ ref: keyed[0], kind: "project", name: listEntities("project").find((x) => x.ref === keyed[0])?.name ?? keyed[0], via: "key" });
    }
  }
  return out;
}

/** Just the refs of `resolveEntity`. */
export const resolveRefs = (input: string): string[] => resolveEntity(input).map((m) => m.ref);

/** The projects (refs) with a link of this kind to this target. */
function projectsWith(rel: "job" | "jira" | "board" | "repo" | "db", target: string): string[] {
  return [...new Set(all<{ ref: string }>("select ref from ent_links where rel = ? and target = ? and ref like 'project:%'", rel, target).map((r) => r.ref))];
}

/** The project of a job number: the one booking on it, else the one linked to it. */
function projectOfJob(number: string): string | null {
  const own = all<{ id: number }>("select p.id from projects p join jobs j on j.id = p.job_id where j.number = ? order by p.active desc, p.id", number);
  if (own.length) return `project:${own[0].id}`;
  return projectsWith("job", number)[0] ?? null;
}

function projectOfTicket(key: string): string | null {
  const t = all<{ board_id: number | null; job_number: string | null }>("select board_id, job_number from jira_tickets where key = ?", key)[0];
  if (t?.board_id != null) {
    const viaBoard = projectsWith("board", String(t.board_id));
    if (viaBoard.length) return viaBoard[0];
    const job = all<{ job_number: string | null }>("select job_number from jira_boards where id = ?", t.board_id)[0]?.job_number;
    if (job) return projectOfJob(job);
  }
  if (t?.job_number) {
    const viaJob = projectOfJob(t.job_number);
    if (viaJob) return viaJob;
  }
  // By its key alone — only when one project has it (a key on two jobs says nothing).
  const prefix = key.split("-")[0].toUpperCase();
  const keyed = projectsWith("jira", prefix);
  return keyed.length === 1 && t?.board_id == null ? keyed[0] : null;
}

/**
 * The project a thing belongs to (its ref) — null when none can be said: a time entry (its project, else its job's), a ticket (its
 * board's project, else its job's, else the one project with its Jira key), a job, a Jira board, a repo, a merge request or other
 * GitLab item (its repo), a todo (its ticket's), a Workspace page (the project its database is linked to).
 */
export function projectOf(ref: string, depth = 0): string | null {
  if (depth > 4) return null;
  entDb();
  const r = ref.trim();
  const colon = r.indexOf(":");
  if (colon < 0) return null;
  const kind = r.slice(0, colon);
  const id = r.slice(colon + 1);
  switch (kind) {
    case "project":
      return all<{ id: number }>("select id from projects where id = ?", Number(id)).length ? r : null;
    case "job":
      return projectOfJob(id);
    case "entry": {
      const e = all<{ project_id: number | null; number: string }>("select e.project_id, j.number from time_entries e join jobs j on j.id = e.job_id where e.id = ?", Number(id))[0];
      if (!e) return null;
      return e.project_id ? `project:${e.project_id}` : projectOfJob(e.number);
    }
    case "ticket":
      return projectOfTicket(id.toUpperCase());
    case "board":
      return projectsWith("board", id)[0] ?? (() => {
        const job = all<{ job_number: string | null }>("select job_number from jira_boards where id = ?", Number(id))[0]?.job_number;
        return job ? projectOfJob(job) : null;
      })();
    case "repo":
      return projectsWith("repo", id)[0] ?? null;
    case "mr":
    case "gitlab": {
      // "mr:group/project!17", "gitlab:group/project!17", or a GitLab item's key "mr:group/project!17".
      const project = id.replace(/^mr:/, "").replace(/[!#]\d+$/, "").replace(/:.*$/, "");
      const repo = all<{ id: number }>("select id from repos where lower(gitlab_project) = lower(?)", project)[0];
      return repo ? projectOf(`repo:${repo.id}`, depth + 1) : null;
    }
    case "todo": {
      const t = all<{ ticket: string }>("select ticket from todos where id = ?", Number(id))[0];
      return t?.ticket && TICKET.test(t.ticket) ? projectOf(`ticket:${t.ticket}`, depth + 1) : null;
    }
    case "page": {
      const linked = projectsWith("db", id)[0];
      if (linked) return linked;
      const p = all<{ kind: string; db_id: number | null; parent_id: number | null }>("select kind, db_id, parent_id from ws_pages where id = ?", Number(id))[0];
      if (!p || p.kind === "database") return null;
      if (p.db_id) return projectOf(`page:${p.db_id}`, depth + 1);
      return p.parent_id ? projectOf(`page:${p.parent_id}`, depth + 1) : null;
    }
    default:
      return null;
  }
}
