/**
 * The timeline's indexer (the Timeline plugin): reads what the syncs and Zeff itself keep — mails, chats, Teams, Jira tickets and
 * comments, GitLab, appointments, time entries, todos, Workspace rows, bank transfers (with Finances), documents — and records each as
 * an event with the entities it concerns (refs.ts). By rule, no AI: cheap enough to run after every sync and every minute. Each source
 * keeps a mark of how far it was read (its time and key, or its id), so a run reads only what is new; a source read for the first
 * time is read from its beginning, a few batches a run (the backfill) — recording an event twice changes nothing. Server only.
 */
import { getSqlite } from "@/db";
import { errorMessage } from "@/lib/errors";
import { isTicketKey, isWorkspaceKey } from "@/lib/ticket-keys";
import { ME_SENDER } from "@/lib/mail/shared";
import { isSentFolder } from "@/lib/mail/mirror";
import { detectRecurring, recipientKey, STRICT } from "@/plugins/finances/recurring";
import { isInstalled } from "@/plugins/state";
import { ME_REF } from "./shared";
import { makeResolver, refsOfRow, type Resolver } from "./refs";
import { eventBySource, recordEvent, type EventInput } from "./store";

/** A time as ISO (UTC): ISO with or without zone, SQLite's "YYYY-MM-DD HH:MM:SS" (UTC), Jira's "… 15:01:52 Mitteleuropäische Sommerzeit" (local), a day (local noon). */
export function toIso(s: string | null | undefined): string | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) d = new Date(`${v}T12:00`);
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) d = new Date(`${v.replace(" ", "T")}Z`);
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?\s+\D/.test(v)) d = new Date(v.slice(0, 19).replace(" ", "T"));
  else d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Event = EventInput & { merge?: boolean };
type Batch = { events: Event[]; mark: string; read: number };
type Source = { id: string; available?: () => boolean; read: (r: Resolver, mark: string, limit: number) => Batch };

const SEP = "\u0001";
const all = <T>(sql: string, ...args: unknown[]): T[] => {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};
const hasTable = (name: string) => !!getSqlite().prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);

/** A source read by a time and a key (rows with the same time read in key order): its rows after the mark. */
function byTime<T extends { at: string; k: string }>(sql: (cond: string) => string, mark: string, limit: number, ...args: unknown[]): { rows: T[]; mark: string } {
  const [at, k] = mark ? mark.split(SEP) : ["", ""];
  const rows = all<T>(`${sql(`(at > ? or (at = ? and k > ?))`)} order by at, k limit ?`, ...args, at, at, k ?? "", limit);
  const last = rows[rows.length - 1];
  return { rows, mark: last ? `${last.at}${SEP}${last.k}` : mark };
}

/** A source read by its id: the rows after the mark. */
function byId<T extends { id: number }>(sql: (cond: string) => string, mark: string, limit: number, ...args: unknown[]): { rows: T[]; mark: string } {
  const rows = all<T>(`${sql("id > ?")} order by id limit ?`, ...args, Number(mark) || 0, limit);
  return { rows, mark: rows.length ? String(rows[rows.length - 1].id) : mark };
}

const people = (ids: number[]) => ids.map((id) => `person:${id}`);
const tickets = (keys: string[]) => keys.map((k) => (isWorkspaceKey(k) ? `page:${k.slice(3)}` : `ticket:${k}`));
const ticketRef = (key: string | null | undefined) => (key && isTicketKey(key) ? tickets([key.toUpperCase()]) : []);
const actor = (id: number | null) => (id ? `person:${id}` : "");
/** Ticket keys as refs, with the projects they belong to (the Entities plugin's). */
const withProjects = (r: Resolver, keys: string[]) => [...tickets(keys), ...keys.filter((k) => !isWorkspaceKey(k)).flatMap((k) => r.entities.ofTicket(k))];
const day = (iso: string) => iso.slice(0, 10);

const MAIL: Source = {
  id: "mail",
  read: (r, mark, limit) => {
    type R = { k: string; at: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string };
    const { rows, mark: next } = byTime<R>((c) => `select key k, received_at at, folder, from_name, from_email, subject, preview from emails where conv_id not like 'wa:%' and conv_id not like 'sg:%' and ${c}`, mark, limit);
    const events = rows.flatMap((m): Event[] => {
      const at = toIso(m.at);
      if (!at) return [];
      // One you sent (the sent folder, or kept as yours): you are who did it.
      const mine = isSentFolder(m.folder) || m.from_name === ME_SENDER;
      const sender = mine ? null : (r.person(m.from_email) ?? r.person(m.from_name));
      const text = `${m.subject} ${m.preview}`;
      const senders = mine ? [] : [m.from_email, m.from_name];
      return [{ at, kind: mine ? "mail.sent" : "mail", source: "mail", sourceRef: m.k, title: m.subject || "(no subject)", summary: m.preview, actorRef: mine ? ME_REF : actor(sender), url: `/mail?q=${encodeURIComponent(m.subject)}`, data: { from: m.from_name ?? m.from_email ?? "", folder: m.folder, ...(mine ? { mine: true } : {}) }, refs: [`mail:${m.k}`, ...people(r.peopleIn(text, ...senders)), ...(mine ? [] : r.entities.ofAddress(m.from_email)), ...withProjects(r, r.tickets(text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** WhatsApp's and Signal's messages (kept beside the mails, their chat as "wa:<name>" / "sg:<name>"). */
const chat = (id: "whatsapp" | "signal", prefix: "wa" | "sg"): Source => ({
  id,
  read: (r, mark, limit) => {
    type R = { k: string; at: string; conv_id: string; from_name: string | null; preview: string };
    const { rows, mark: next } = byTime<R>((c) => `select key k, received_at at, conv_id, from_name, preview from emails where conv_id like '${prefix}:%' and ${c}`, mark, limit);
    const events = rows.flatMap((m): Event[] => {
      const at = toIso(m.at);
      if (!at) return [];
      const name = m.conv_id.slice(3);
      const mine = m.from_name === ME_SENDER;
      const sender = m.from_name && !mine ? r.person(m.from_name) : null;
      const owner = r.byChat(m.conv_id);
      const ids = new Set([...r.peopleIn(m.preview, mine ? null : m.from_name), ...(owner ? [owner] : [])]);
      return [{ at, kind: "message", source: id, sourceRef: m.k, title: name, summary: m.preview, actorRef: mine ? ME_REF : actor(sender), url: `/mail?q=${encodeURIComponent(name)}`, data: { chat: name, from: m.from_name ?? "" }, refs: [`msg:${id}:${m.k}`, ...people([...ids]), ...tickets(r.tickets(m.preview))] }];
    });
    return { events, mark: next, read: rows.length };
  },
});

const TEAMS: Source = {
  id: "teams",
  read: (r, mark, limit) => {
    type R = { k: string; at: string; sender_name: string | null; place: string | null; text: string; link: string; subject: string | null };
    const { rows, mark: next } = byTime<R>((c) => `select key k, sent_at at, sender_name, place, text, link, subject from teams_messages where ${c}`, mark, limit);
    const events = rows.flatMap((m): Event[] => {
      const at = toIso(m.at);
      if (!at) return [];
      const text = `${m.subject ?? ""} ${m.text}`;
      return [{ at, kind: "message", source: "teams", sourceRef: m.k, title: [m.sender_name, m.place].filter(Boolean).join(" · ") || "Teams", summary: m.text, actorRef: actor(r.person(m.sender_name)), url: m.link, data: { from: m.sender_name ?? "", place: m.place ?? "" }, refs: [`msg:teams:${m.k}`, ...people(r.peopleIn(text, m.sender_name)), ...tickets(r.tickets(text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** Jira's tickets: opened (once), moved to another status, updated otherwise — told apart by what the indexer saw last of each. */
const JIRA: Source = {
  id: "jira",
  read: (r, mark, limit) => {
    const d = getSqlite();
    d.exec("create table if not exists tl_ticket_state (key text primary key, status text not null, updated_at text not null)");
    type R = { k: string; at: string; summary: string; status: string; status_category: string; assignee: string | null; url: string | null; opened_at: string | null };
    const { rows, mark: next } = byTime<R>((c) => `select key k, coalesce(updated_at, opened_at, '') at, summary, status, status_category, assignee, url, opened_at from jira_tickets where ${c}`, mark, limit);
    const events: Event[] = [];
    for (const t of rows) {
      const seen = d.prepare("select status, updated_at from tl_ticket_state where key = ?").get(t.k) as { status: string; updated_at: string } | undefined;
      const refs = [`ticket:${t.k}`, ...r.entities.ofTicket(t.k), ...people(r.peopleIn(t.summary, t.assignee)), ...tickets(r.tickets(t.summary).filter((k) => k !== t.k))];
      const base = { source: "jira", url: t.url ?? "", summary: t.summary, data: { status: t.status, category: t.status_category, assignee: t.assignee ?? "" }, refs };
      const opened = toIso(t.opened_at);
      if (opened) events.push({ ...base, at: opened, kind: "ticket.created", sourceRef: `${t.k}:created`, title: `${t.k} ${t.summary}` });
      const at = toIso(t.at);
      if (seen && at && seen.updated_at !== t.at) {
        if (seen.status !== t.status) events.push({ ...base, at, kind: "ticket.status", sourceRef: `${t.k}:status:${t.at}`, title: `${t.k}: ${seen.status} → ${t.status}`, data: { ...base.data, from: seen.status } });
        else events.push({ ...base, at, kind: "ticket.updated", sourceRef: `${t.k}:updated:${t.at}`, title: `${t.k} ${t.summary}` });
      }
      d.prepare("insert into tl_ticket_state (key, status, updated_at) values (?, ?, ?) on conflict(key) do update set status = excluded.status, updated_at = excluded.updated_at").run(t.k, t.status, t.at);
    }
    return { events, mark: next, read: rows.length };
  },
};

const JIRA_COMMENTS: Source = {
  id: "jira-comments",
  read: (r, mark, limit) => {
    type R = { k: string; at: string; ticket: string; author: string; body: string; url: string | null };
    const { rows, mark: next } = byTime<R>((c) => `select * from (select c.id k, c.at at, c.ticket, c.author, c.body, t.url from jira_comments c left join jira_tickets t on t.key = c.ticket) where ${c}`, mark, limit);
    const events = rows.flatMap((c): Event[] => {
      const at = toIso(c.at);
      if (!at) return [];
      return [{ at, kind: "comment", source: "jira", sourceRef: `comment:${c.k}`, title: `${c.ticket} · ${c.author}`, summary: c.body, actorRef: actor(r.person(c.author)), url: c.url ?? "", data: { author: c.author }, refs: [...ticketRef(c.ticket), ...people(r.peopleIn(c.body, c.author)), ...tickets(r.tickets(c.body))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** GitLab: a merge request opened, merged or closed; a comment on one. */
const GITLAB: Source = {
  id: "gitlab",
  read: (r, mark, limit) => {
    type R = { k: string; at: string; kind: string; ref: string; title: string; body: string; author: string | null; state: string | null; created_at: string | null; url: string; branch: string | null; parent: string | null };
    const { rows, mark: next } = byTime<R>((c) => `select * from (select key k, coalesce(updated_at, created_at, synced_at) at, kind, ref, title, body, author, state, created_at, url, branch, parent from gitlab_items where kind in ('mr', 'comment')) where ${c}`, mark, limit);
    const events: Event[] = [];
    for (const g of rows) {
      const text = `${g.title} ${g.branch ?? ""}`;
      const refs = [...people(r.peopleIn(g.kind === "comment" ? g.body : g.title, g.author)), ...tickets(r.tickets(`${text} ${g.kind === "comment" ? "" : g.body.slice(0, 2000)}`))];
      const created = toIso(g.created_at) ?? toIso(g.at);
      if (!created) continue;
      if (g.kind === "comment") {
        events.push({ at: created, kind: "mr.comment", source: "gitlab", sourceRef: g.k, title: `${g.ref} ${g.title}`, summary: g.body, actorRef: actor(r.person(g.author)), url: g.url, data: { author: g.author ?? "" }, refs });
        continue;
      }
      events.push({ at: created, kind: "mr.opened", source: "gitlab", sourceRef: `${g.k}:opened`, title: `${g.ref} ${g.title}`, summary: g.body, actorRef: actor(r.person(g.author)), url: g.url, data: { author: g.author ?? "" }, refs });
      const st = String(g.state ?? "").split(/\s/)[0];
      const at = toIso(g.at);
      if ((st === "merged" || st === "closed") && at) events.push({ at, kind: `mr.${st}`, source: "gitlab", sourceRef: `${g.k}:${st}`, title: `${g.ref} ${g.title}`, summary: "", url: g.url, data: {}, refs });
    }
    return { events, mark: next, read: rows.length };
  },
};

/** Appointments (by when they are), with the people among their attendees. */
const CALENDAR: Source = {
  id: "calendar",
  read: (r, mark, limit) => {
    type R = { id: number; title: string; start: string; location: string; description: string; organizer: string; attendees: string; url: string; cancelled: number; private: number };
    const { rows, mark: next } = byId<R>((c) => `select id, title, start, location, description, organizer, attendees, url, cancelled, private from calendar_events where ${c}`, mark, limit);
    const events = rows.flatMap((e): Event[] => {
      const at = toIso(e.start);
      if (!at || e.cancelled) return [];
      let attendees: string[] = [];
      try {
        attendees = (JSON.parse(e.attendees) as unknown[]).map(String);
      } catch {
        attendees = [];
      }
      const text = `${e.title} ${e.private ? "" : e.description.slice(0, 2000)}`;
      return [{ at, kind: "meeting", source: "calendar", sourceRef: String(e.id), title: e.title, summary: e.location, url: `/kalender?v=day&d=${e.start.slice(0, 10)}`, data: { start: e.start }, refs: [`event:${e.id}`, ...people(r.peopleIn(e.title, e.organizer, ...attendees)), ...r.entities.ofPlace(e.location), ...[e.organizer, ...attendees].flatMap((a) => r.entities.ofAddress(a)), ...withProjects(r, r.tickets(text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

const TIME: Source = {
  id: "time",
  read: (r, mark, limit) => {
    type R = { id: number; date: string; start: string | null; hours: number; description: string; ticket: string | null; project_id: number | null; number: string | null; reported_by: string };
    const { rows, mark: next } = byId<R>((c) => `select * from (select e.id, e.date, e.start, e.hours, e.description, e.ticket, e.project_id, j.number, e.reported_by from time_entries e left join jobs j on j.id = e.job_id) where ${c}`, mark, limit);
    const events = rows.flatMap((e): Event[] => {
      const at = toIso(e.start ? `${e.date}T${e.start}` : e.date);
      if (!at) return [];
      return [{ at, kind: "time", source: "time", sourceRef: String(e.id), title: `${e.hours} h · ${e.description}`, summary: e.ticket ?? "", url: `/entries/${e.id}`, data: { hours: e.hours, by: e.reported_by }, refs: [`entry:${e.id}`, ...ticketRef(e.ticket), ...(e.project_id ? [`project:${e.project_id}`] : []), ...(e.number ? [`job:${e.number}`] : []), ...people(r.peopleIn(e.description)), ...tickets(r.tickets(e.description))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** Todos made, done, dropped, opened again, merged — as the todos' own log (todo_events) has them. */
const TODOS: Source = {
  id: "todos",
  read: (r, mark, limit) => {
    type R = { id: number; todo_id: number; event: string; ticket: string; text: string; note: string | null; actor: string | null; at: string };
    const { rows, mark: next } = byId<R>((c) => `select id, todo_id, event, ticket, text, note, actor, at from todo_events where ${c}`, mark, limit);
    const events = rows.flatMap((e): Event[] => {
      const at = toIso(e.at);
      if (!at) return [];
      return [{ at, kind: `todo.${e.event}`, source: "todos", sourceRef: String(e.id), title: e.text, summary: e.note ?? "", url: `/t/${e.todo_id}`, data: { actor: e.actor ?? "", ticket: e.ticket }, refs: [`todo:${e.todo_id}`, ...ticketRef(e.ticket), ...people(r.peopleIn(e.text)), ...tickets(r.tickets(e.text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/**
 * Workspace rows added and changed — from the rows' own history (ws_activity), what you and the AI did; a source's writes (a
 * pipeline's mirror of mails or tickets) are those sources' events already. A day's changes to a row are one event. With `pages`:
 * the pages (not rows of a database) — made, and edited (a day's edits to a page one event).
 */
const activity = (id: "workspace" | "pages", pages: boolean): Source => ({
  id,
  read: (r, mark, limit) => {
    type R = { id: number; page_id: number; at: string; actor: string; field: string; old: string; new: string; title: string; db_id: number | null };
    const where = pages ? "p.db_id is null" : "p.db_id is not null";
    const { rows, mark: next } = byId<R>((c) => `select * from (select a.id, a.page_id, a.at, a.actor, a.field, a.old, a.new, p.title, p.db_id from ws_activity a join ws_pages p on p.id = a.page_id where ${where} and a.actor != 'source') where ${c}`, mark, limit);
    const events: Event[] = [];
    const rowRefs = new Map<number, string[]>();
    const refsOf = (row: R) => {
      if (!rowRefs.has(row.page_id)) rowRefs.set(row.page_id, [...(pages ? [`page:${row.page_id}`] : [...refsOfRow(row.page_id), `page:${row.db_id}`]), ...people(r.peopleIn(row.title)), ...withProjects(r, r.tickets(row.title))]);
      return rowRefs.get(row.page_id)!;
    };
    const what = pages ? "page" : "row";
    // The day's change events of the rows, gathered while reading (the fields changed, the last value of each).
    const days = new Map<string, Event & { fields: Record<string, string>; actors: Set<string> }>();
    for (const a of rows) {
      const at = toIso(a.at);
      if (!at) continue;
      if (a.field === "created") {
        events.push({ at, kind: `${what}.added`, source: id, sourceRef: `${what}:${a.page_id}:added`, title: a.title, summary: "", actorRef: a.actor === "you" ? ME_REF : "", url: `/workspace/${a.page_id}`, data: { actor: a.actor, ...(pages ? {} : { db: a.db_id }) }, refs: refsOf(a) });
        continue;
      }
      const ref = `${what}:${a.page_id}:changed:${day(at)}`;
      let ev = days.get(ref);
      if (!ev) {
        const had = eventBySource(id, ref);
        const fields = ((had?.data.fields as Record<string, string> | undefined) ?? {}) as Record<string, string>;
        const actors = new Set(String(had?.data.actor ?? "").split(",").filter(Boolean));
        ev = { at, kind: `${what}.changed`, source: id, sourceRef: ref, title: a.title, summary: "", url: `/workspace/${a.page_id}`, data: {}, refs: refsOf(a), merge: true, fields: { ...fields }, actors };
        days.set(ref, ev);
      }
      if (at > ev.at) ev.at = at;
      ev.title = a.title;
      ev.actors.add(a.actor);
      ev.fields[a.field] = a.field === "text" ? "" : a.field === "trash" || a.field === "restored" ? "" : a.new;
    }
    for (const ev of days.values()) {
      const { fields, actors, ...rest } = ev;
      // (rows: "you" as before — the AI's changes of a row are told on the row itself)
      const by = pages ? [...actors].sort().join(",") : "you";
      events.push({ ...rest, actorRef: by === "you" ? ME_REF : "", data: { actor: by, fields }, summary: Object.entries(fields).map(([f, v]) => (v ? `${f}: ${v}` : f)).join(" · ") });
    }
    return { events, mark: next, read: rows.length };
  },
});

/** Google Keep's notes: when each was made — read again when it changes (its title, its text, the people and tickets in it). */
const KEEP: Source = {
  id: "keep",
  available: () => isInstalled("keep") && hasTable("keep_notes"),
  read: (r, mark, limit) => {
    type R = { k: string; at: string; title: string; text: string; created_at: string | null; url: string; archived: number };
    const { rows, mark: next } = byTime<R>((c) => `select * from (select id k, coalesce(updated_at, created_at, synced_at) at, title, substr(text, 1, 4000) text, created_at, url, archived from keep_notes) where ${c}`, mark, limit);
    const events = rows.flatMap((n): Event[] => {
      const at = toIso(n.created_at) ?? toIso(n.at);
      if (!at) return [];
      const text = `${n.title}\n${n.text}`;
      const title = n.title || n.text.split(/\r?\n/)[0].replace(/^- \[[ xX]\] /, "").slice(0, 120) || "Keep";
      return [{ at, kind: "note", source: "keep", sourceRef: n.k, title, summary: n.text, actorRef: ME_REF, url: n.url, data: { archived: !!n.archived }, refs: [`keep:${n.k}`, ...people(r.peopleIn(text)), ...withProjects(r, r.tickets(text))], merge: true }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** What your clicks on a todo's action buttons ran (a mail sent through Gmail, an appointment entered — actions/clicked.ts). */
const ACTIONS: Source = {
  id: "actions",
  available: () => hasTable("action_clicks"),
  read: (r, mark, limit) => {
    type R = { id: number; at: string; todo_id: number; type: string; what: string; op: string; text: string | null; ticket: string | null };
    const { rows, mark: next } = byId<R>((c) => `select * from (select a.id, a.at, a.todo_id, a.type, a.what, a.op, t.text, t.ticket from action_clicks a left join todos t on t.id = a.todo_id) where ${c}`, mark, limit);
    const events = rows.flatMap((a): Event[] => {
      const at = toIso(a.at);
      if (!at) return [];
      let op: Record<string, unknown> = {};
      try {
        op = JSON.parse(a.op) as Record<string, unknown>;
      } catch {
        op = {};
      }
      // Whom it went to: the addresses and names the action names (to, cc, attendees …).
      const to = Object.values(op).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === "string" && v.length < 200);
      const text = `${a.what} ${a.text ?? ""}`;
      return [{ at, kind: "action", source: "actions", sourceRef: String(a.id), title: a.what || a.type, summary: a.text ?? "", actorRef: ME_REF, url: `/t/${a.todo_id}`, data: { type: a.type }, refs: [`todo:${a.todo_id}`, ...ticketRef(a.ticket), ...people(r.peopleIn(text, ...to.filter((v) => v.includes("@") || v.trim().split(/\s+/).length <= 4))), ...withProjects(r, r.tickets(text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/**
 * Bank transfers (the cases' bank statements) — with the Finances plugin: whom they went to (the booking's person — its account or
 * its name, cases/bank.ts) as who it was with, the case they paid, the recurring payment (a contract) they are one of.
 */
const BANK: Source = {
  id: "bank",
  available: () => isInstalled("finances") && hasTable("bank_transactions"),
  read: (r, mark, limit) => {
    type R = { k: string; at: string; date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; case_id: number | null; person_id: number | null };
    const hasPerson = all<{ name: string }>("pragma table_info(bank_transactions)").some((c) => c.name === "person_id");
    const { rows, mark: next } = byTime<R>((c) => `select * from (select id k, imported_at at, date, amount, currency, text, counterparty, iban, case_id, ${hasPerson ? "person_id" : "null person_id"} from bank_transactions) where ${c}`, mark, limit);
    if (!rows.length) return { events: [], mark: next, read: 0 };
    const caseRow = (id: number) => all<{ id: number }>("select id from ws_pages where archived_at is null and json_extract(props, '$.srcref') = ? limit 1", `case:${id}`)[0]?.id;
    // The recipients that are paid in a rhythm (the Finances plugin's contracts: "recurring:<key>"), read once a batch.
    const recurring = new Set<string>();
    try {
      const from = new Date(Date.now() - 800 * 864e5).toISOString().slice(0, 10);
      const bookings = all<{ date: string; amount: number; text: string; counterparty: string }>("select date, amount, text, counterparty from bank_transactions where date >= ? and amount < 0 order by date", from);
      for (const x of detectRecurring(bookings, new Date().toISOString().slice(0, 10), STRICT)) recurring.add(x.key);
    } catch {
      // no rhythm read: no contract refs
    }
    const events = rows.flatMap((t): Event[] => {
      const at = toIso(t.date);
      if (!at) return [];
      const row = t.case_id ? caseRow(t.case_id) : undefined;
      const amount = `${t.amount.toFixed(2)} ${t.currency}`;
      const who = t.person_id ?? r.byIban(t.iban) ?? r.person(t.counterparty);
      const key = t.amount < 0 ? recipientKey(t) : "";
      return [{ at, kind: "payment", source: "bank", sourceRef: t.k, title: `${amount} · ${t.counterparty || t.text}`, summary: t.text, actorRef: actor(who), url: row ? `/workspace/${row}` : "", data: { amount: t.amount, currency: t.currency, counterparty: t.counterparty }, refs: [...(row ? [`page:${row}`] : []), ...(key && recurring.has(key) ? [`recurring:${key}`] : []), ...people([...new Set([...(who ? [who] : []), ...r.peopleIn(t.text, t.counterparty)])]), ...tickets(r.tickets(t.text))] }];
    });
    return { events, mark: next, read: rows.length };
  },
};

/** Documents: when they came — read again when their text is out (by when they changed), so the people in it are found. */
const DOCUMENTS: Source = {
  id: "documents",
  read: (r, mark, limit) => {
    type R = { k: string; at: string; id: number; name: string; summary: string; text: string; created_at: string };
    const { rows, mark: next } = byTime<R>((c) => `select * from (select printf('%010d', id) k, updated_at at, id, name, summary, substr(text, 1, 6000) text, created_at from documents) where ${c}`, mark, limit);
    const events = rows.flatMap((doc): Event[] => {
      const at = toIso(doc.created_at);
      if (!at) return [];
      const text = `${doc.name}\n${doc.summary}\n${doc.text}`;
      return [{ at, kind: "document", source: "documents", sourceRef: String(doc.id), title: doc.name, summary: doc.summary, url: `/api/documents/${doc.id}/file`, data: {}, refs: [`doc:${doc.id}`, ...people(r.peopleIn(text)), ...tickets(r.tickets(text))], merge: true }];
    });
    return { events, mark: next, read: rows.length };
  },
};

export const SOURCES: Source[] = [MAIL, chat("whatsapp", "wa"), chat("signal", "sg"), TEAMS, JIRA, JIRA_COMMENTS, GITLAB, CALENDAR, TIME, TODOS, activity("workspace", false), activity("pages", true), KEEP, ACTIONS, BANK, DOCUMENTS];

function marks() {
  const d = getSqlite();
  d.exec("create table if not exists tl_marks (source text primary key, mark text not null)");
  return d;
}
const markOf = (source: string) => (marks().prepare("select mark from tl_marks where source = ?").get(source) as { mark: string } | undefined)?.mark ?? "";
const setMark = (source: string, mark: string) => marks().prepare("insert into tl_marks (source, mark) values (?, ?) on conflict(source) do update set mark = excluded.mark").run(source, mark);

export type IndexResult = { ok: boolean; added: number; read: number; more: boolean; bySource: Record<string, number>; error?: string };

const flag = globalThis as { __zeffTimelineIndex?: boolean };

/**
 * Read what is new in every source into the timeline: `batch` rows a batch, at most `maxBatches` batches a source a run (`more`:
 * some source has more to read — the backfill goes on next time). A source that fails is left for the next run; the others go on.
 */
export async function indexTimeline(opts: { batch?: number; maxBatches?: number; only?: string[] } = {}): Promise<IndexResult> {
  const out: IndexResult = { ok: true, added: 0, read: 0, more: false, bySource: {} };
  if (flag.__zeffTimelineIndex) return { ...out, ok: false, error: "already running" };
  flag.__zeffTimelineIndex = true;
  const errors: string[] = [];
  try {
    const r = makeResolver();
    const batch = opts.batch ?? 500;
    for (const s of SOURCES) {
      if (opts.only && !opts.only.includes(s.id)) continue;
      if (s.available && !s.available()) continue;
      try {
        for (let i = 0; i < (opts.maxBatches ?? 4); i++) {
          const b = s.read(r, markOf(s.id), batch);
          const d = getSqlite();
          d.transaction(() => {
            for (const { merge, ...e } of b.events) if (recordEvent(e, { merge }).created) (out.added++, (out.bySource[s.id] = (out.bySource[s.id] ?? 0) + 1));
            setMark(s.id, b.mark);
          })();
          out.read += b.read;
          if (b.read < batch) break;
          if (i === (opts.maxBatches ?? 4) - 1) out.more = true;
          await new Promise((res) => setImmediate(res));
        }
      } catch (e) {
        errors.push(`${s.id}: ${errorMessage(e)}`);
      }
    }
  } finally {
    flag.__zeffTimelineIndex = false;
  }
  if (errors.length) return { ...out, ok: false, error: errors.join("; ") };
  return out;
}

