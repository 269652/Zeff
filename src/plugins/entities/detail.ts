/**
 * What Zeff knows about an organisation, a place or a project, gathered (the Entities plugin): an organisation's people, projects,
 * their tickets, the latest mails from its domains and the money between you (the bank's counterparties of its name); a place's
 * people and appointments; a project's job, Jira keys, boards, repos, databases, booked hours, open tickets and latest entries.
 * The page of its row in the Workspace and the MCP's entity_get show it. Server only.
 */
import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { linksTo } from "@/plugins/people/graph";
import { getPerson } from "@/plugins/people/store";
import { normalizeAddress, normalizeOrgName } from "./normalize";
import { entityLinks, getEntity, listEntities, parseRef, type Entity, type EntityLink } from "./store";

export type EntityDetail = Entity & {
  links: EntityLink[];
  /** People linked to it (works at, lives at). */
  people: { ref: string; name: string; rel: string }[];
  /** An organisation's projects. */
  projects: { ref: string; name: string }[];
  /** A project's booked hours (null: none, or not a project). */
  hours: number | null;
  /** What it gathers, under headings. */
  sections: { title: string; items: string[] }[];
};

function all<T>(sql: string, ...args: unknown[]): T[] {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

function peopleOf(e: Entity): EntityDetail["people"] {
  if (e.kind === "project") return [];
  try {
    return linksTo(e.kind, String(e.id)).flatMap((l) => {
      const p = getPerson(l.personId);
      return p ? [{ ref: `person:${p.id}`, name: p.name, rel: l.rel }] : [];
    });
  } catch {
    return [];
  }
}

/** A project's tickets: on its boards, booked on its job, or of its Jira keys — the open ones first. */
function projectTickets(p: Entity, links: EntityLink[], limit: number): { key: string; summary: string; status: string }[] {
  const boards = links.filter((l) => l.rel === "board").map((l) => Number(l.target));
  const keys = links.filter((l) => l.rel === "jira").map((l) => l.target);
  const jobs = [p.address, ...links.filter((l) => l.rel === "job").map((l) => l.target)].filter(Boolean);
  const where: string[] = [];
  const args: unknown[] = [];
  if (boards.length) (where.push(`board_id in (${boards.map(() => "?").join(",")})`), args.push(...boards));
  if (jobs.length) (where.push(`job_number in (${jobs.map(() => "?").join(",")})`), args.push(...jobs));
  // A key alone only when no board says more (PROJ may be two jobs).
  if (!boards.length) for (const k of keys) (where.push("key like ?"), args.push(`${k}-%`));
  if (!where.length) return [];
  return all<{ key: string; summary: string; status: string }>(`select key, summary, status from jira_tickets where ${where.join(" or ")} order by status_category = 'done', coalesce(updated_at, synced_at) desc limit ?`, ...args, limit);
}

/** Everything about an entity, gathered — null when there is no such one. */
export function entityDetail(ref: string): EntityDetail | null {
  const e = getEntity(ref);
  if (!e) return null;
  const links = entityLinks(ref);
  const people = peopleOf(e);
  const sections: EntityDetail["sections"] = [];
  let projects: Entity[] = [];
  let hours: number | null = null;
  const section = (title: string, items: string[]) => {
    if (items.length) sections.push({ title, items });
  };
  section(t("People"), people.map((p) => `${p.name} (${p.rel})`));
  if (e.kind === "org") {
    const forms = new Set([e.name, ...e.aliases].map(normalizeOrgName));
    projects = listEntities("project").filter((p) => entityLinks(p.ref).some((l) => l.rel === "org" && l.target === ref));
    for (const p of all<{ id: number; customer: string }>("select id, customer from projects where customer is not null")) {
      if (forms.has(normalizeOrgName(p.customer)) && !projects.some((x) => x.id === p.id)) {
        const pe = getEntity(`project:${p.id}`);
        if (pe) projects.push(pe);
      }
    }
    section(t("Projects"), projects.map((p) => p.name));
    section(t("Tickets"), projects.flatMap((p) => projectTickets(p, entityLinks(p.ref), 6)).slice(0, 10).map((x) => `${x.key} ${x.summary} (${x.status})`));
    const mails = e.domains.flatMap((d) => all<{ received_at: string; from_name: string | null; subject: string }>("select received_at, from_name, subject from emails where lower(from_email) like ? or lower(from_email) like ? order by received_at desc limit 8", `%@${d}`, `%.${d}`));
    section(t("Latest mails"), mails.sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 8).map((m) => `${m.received_at.slice(0, 10)} — ${m.from_name ?? ""}: ${m.subject}`));
    const money = all<{ counterparty: string; amount: number; date: string }>("select counterparty, amount, date from bank_transactions where counterparty != ''").filter((b) => forms.has(normalizeOrgName(b.counterparty)));
    if (money.length) {
      const got = money.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0);
      const paid = money.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0);
      const last = money.map((m) => m.date).sort().at(-1) ?? "";
      section(t("Money"), [t("Paid: {amount}", { amount: euro(paid) }), t("Received: {amount}", { amount: euro(got) }), t("{n} payments, the last on {date}", { n: money.length, date: last.slice(0, 10) })]);
    }
  } else if (e.kind === "place") {
    const forms = new Set([e.name, ...e.aliases, e.address].filter(Boolean).map(normalizeAddress));
    const events = all<{ title: string; start: string; location: string }>("select title, start, location from calendar_events where location != '' and cancelled = 0 order by start desc limit 2000").filter((x) => forms.has(normalizeAddress(x.location)));
    section(t("Appointments"), events.slice(0, 10).map((x) => `${x.start.replace("T", " ")} — ${x.title}`));
  } else {
    const parsed = parseRef(ref)!;
    // Its entries: booked on it, or on its job without a project (what projectOf counts as its).
    const mine = "(project_id = ? or (project_id is null and job_id = (select job_id from projects where id = ?)))";
    const stats = all<{ n: number; h: number; last: string | null }>(`select count(*) n, coalesce(sum(hours), 0) h, max(date) last from time_entries where ${mine}`, parsed.id, parsed.id)[0];
    const label = (rel: string) => links.filter((l) => l.rel === rel).map((l) => (l.label ? `${l.label} (${l.target})` : l.target));
    section(t("Belongs to it"), [
      ...(e.address ? [t("Job {number}", { number: e.address })] : []),
      ...label("job").map((x) => t("Job {number}", { number: x })),
      ...label("jira").map((x) => t("Jira key {key}", { key: x })),
      ...label("board").map((x) => t("Jira board {board}", { board: x })),
      ...label("repo").map((x) => t("Repo {repo}", { repo: x })),
      ...label("db").map((x) => t("Database {db}", { db: x })),
      ...links.filter((l) => l.rel === "org").map((l) => t("For {org}", { org: l.label || l.target })),
    ]);
    if (stats?.n) hours = Math.round(stats.h * 100) / 100;
    if (stats?.n) section(t("Booked"), [t("{h} h in {n} entries, the last on {date}", { h: Math.round(stats.h * 100) / 100, n: stats.n, date: stats.last ?? "" })]);
    section(t("Tickets"), projectTickets(e, links, 12).map((x) => `${x.key} ${x.summary} (${x.status})`));
    section(t("Latest entries"), all<{ date: string; hours: number; description: string }>(`select date, hours, description from time_entries where ${mine} order by date desc, id desc limit 6`, parsed.id, parsed.id).map((x) => `${x.date} ${x.hours} h — ${x.description}`));
  }
  return { ...e, links, people, projects: projects.map((p) => ({ ref: p.ref, name: p.name })), hours, sections };
}

/** An entity's gathering as Markdown (headings, lists) — its row's page text. */
export function detailText(d: Pick<EntityDetail, "note" | "sections">): string {
  const nl = String.fromCharCode(10);
  return [d.note, ...d.sections.map((s) => `## ${s.title}${nl}${s.items.map((x) => `- ${x}`).join(nl)}`)].filter(Boolean).join(nl + nl);
}
