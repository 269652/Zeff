import { getSqlite } from "@/db";
import { has, hasAny, type Condition, type Filters, type Item, type QueryView } from "./view-types";

/**
 * The views Zeff brings itself (structured questions, views.ts): time entries, bank transactions (Finances), calendar
 * events, todos, mails and messages, and the Workspace's databases through their own rows. Each reads with fixed SQL and
 * the filters bound as values, or through the module that owns the data; the descriptions are what the AI reads when it
 * plans a query. Server only.
 */

const MIN_DAY = "0000-01-01";
const MAX_DAY = "9999-12-31";
const fromOf = (f: Filters) => (typeof f.from === "string" ? f.from : MIN_DAY);
const toOf = (f: Filters) => (typeof f.to === "string" ? f.to : MAX_DAY);
const str = (f: Filters, k: string): string | null => (typeof f[k] === "string" && f[k] ? (f[k] as string) : null);
const list = (f: Filters, k: string): string[] | null => (Array.isArray(f[k]) && (f[k] as unknown[]).length ? (f[k] as string[]) : null);

/** Rows of a query that may find no table (a plugin that never ran): none. */
function rows<T>(sql: string, ...args: unknown[]): T[] {
  try {
    return getSqlite()
      .prepare(sql)
      .all(...args) as T[];
  } catch {
    return [];
  }
}

const DATE_FILTERS = {
  from: { type: "date", description: "ab diesem Tag (YYYY-MM-DD; YYYY-MM oder YYYY: ab dessen erstem Tag)" },
  to: { type: "date", description: "bis einschließlich diesem Tag (YYYY-MM oder YYYY: bis dessen letztem Tag)" },
} as const;

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

type ERow = { id: number; date: string; hours: number; description: string; ticket: string | null; type: string; reported_by: string; job: string; job_name: string; customer: string | null; project: string | null };

const timeEntries: QueryView = {
  name: "time_entries",
  description: "Gebuchte Arbeitszeit (Zeiterfassung): je Eintrag Tag, Stunden, Beschreibung, Ticket, Auftrag (Job), Projekt, Art. Für „wie viele Stunden …“, „welche Tickets/Projekte haben am meisten Zeit gekostet“, „wann habe ich zuletzt an X gearbeitet“.",
  filters: {
    ...DATE_FILTERS,
    project: { type: "text", description: "Projekt (Teil des Namens)" },
    job: { type: "text", description: "Auftrag: Nummer oder Teil des Namens" },
    ticket: { type: "text", description: "Ticket-Key oder sein Anfang (PROJ-337, PROJ)" },
    text: { type: "text", description: "Teil der Beschreibung" },
    type: { type: "text", description: "Art der Arbeit (entry type key)" },
    customer: { type: "text", description: "Kunde des Auftrags (Teil)" },
  },
  dims: ["ticket", "project", "job", "customer", "type", "reportedBy"],
  measures: { hours: "Stunden (dezimal)" },
  items(f) {
    return rows<ERow>(
      "select e.id, e.date, e.hours, e.description, e.ticket, e.type, e.reported_by, j.number job, j.name job_name, j.customer, p.title project from time_entries e join jobs j on j.id = e.job_id left join projects p on p.id = e.project_id where e.date >= ? and e.date <= ? order by e.date",
      fromOf(f),
      toOf(f),
    )
      .filter((r) => {
        const project = str(f, "project");
        const job = str(f, "job");
        const ticket = str(f, "ticket");
        const text = str(f, "text");
        const type = str(f, "type");
        const customer = str(f, "customer");
        return (!project || has(r.project, project)) && (!job || has(`${r.job} ${r.job_name}`, job)) && (!ticket || (r.ticket ?? "").toUpperCase().startsWith(ticket.toUpperCase())) && (!text || has(r.description, text)) && (!type || r.type === type) && (!customer || has(r.customer, customer));
      })
      .map(
        (r): Item => ({
          at: r.date,
          title: `${r.ticket ? `${r.ticket} · ` : ""}${r.description}`,
          ref: `entry:${r.id}`,
          href: `/entries/${r.id}`,
          values: { hours: r.hours },
          dims: { ticket: r.ticket ?? "", project: r.project ?? "", job: `${r.job} ${r.job_name}`.trim(), customer: r.customer ?? "", type: r.type, reportedBy: r.reported_by },
        }),
      );
  },
};

// ---------------------------------------------------------------------------
// Bank transactions (the Finances plugin; kept by the cases' bank sync)
// ---------------------------------------------------------------------------

type TRow = { id: string; account: string; date: string; amount: number; currency: string; text: string; counterparty: string; reference: string; case_id: number | null };

const bankTransactions: QueryView = {
  name: "bank_transactions",
  plugin: "finances",
  description:
    "Kontobewegungen von den Kontoauszügen: Tag, Betrag (Eingänge positiv, Ausgaben negativ), Gegenseite (counterparty), Buchungstext, Konto. Für „wie viel habe ich für X ausgegeben“, „was kam von Y“, Ausgaben je Monat. Eine Kategorie gibt es nicht — nenne die Gegenseiten bzw. Wörter im Text, die dazugehören (z. B. für Handwerker: maler, elektro, sanitär, schreiner, fliesen, dach …), und nimm für Ausgaben direction=out und measure=abs.",
  filters: {
    ...DATE_FILTERS,
    counterparty: { type: "texts", description: "eines dieser Wörter in der Gegenseite" },
    text: { type: "texts", description: "eines dieser Wörter in Gegenseite, Buchungstext oder Verwendungszweck" },
    direction: { type: "enum", values: ["in", "out"], description: "in: Eingänge, out: Ausgaben" },
    account: { type: "text", description: "Konto (Teil der Kennung)" },
    minAmount: { type: "number", description: "Betrag (ohne Vorzeichen) mindestens" },
    maxAmount: { type: "number", description: "Betrag (ohne Vorzeichen) höchstens" },
  },
  dims: ["counterparty", "account", "direction"],
  measures: { amount: "Betrag in Euro mit Vorzeichen (Ausgaben negativ)", abs: "Betrag in Euro ohne Vorzeichen" },
  async items(f) {
    const cp = list(f, "counterparty");
    const words = list(f, "text");
    const dir = str(f, "direction");
    const account = str(f, "account");
    const min = typeof f.minAmount === "number" ? f.minAmount : null;
    const max = typeof f.maxAmount === "number" ? f.maxAmount : null;
    const found = rows<TRow>("select id, account, date, amount, currency, text, counterparty, reference, case_id from bank_transactions where date >= ? and date <= ? order by date", fromOf(f), toOf(f))
      .filter((r) => (!cp || hasAny(r.counterparty, cp)) && (!words || hasAny(`${r.counterparty} ${r.text} ${r.reference}`, words)) && (!dir || (dir === "in" ? r.amount > 0 : r.amount < 0)) && (!account || has(r.account, account)) && (min === null || Math.abs(r.amount) >= min) && (max === null || Math.abs(r.amount) <= max));
    // A payment matched to a case links to the case.
    const cases = new Map<number, string>();
    for (const id of new Set(found.map((r) => r.case_id).filter((x): x is number => x !== null))) {
      try {
        cases.set(id, await (await import("@/plugins/cases/database")).caseHref(id));
      } catch {
        // the case is gone
      }
    }
    return found.map(
      (r): Item => ({
        at: r.date,
        title: `${r.counterparty || r.text}${r.counterparty && r.text ? ` — ${r.text}` : ""} (${r.amount.toFixed(2)} ${r.currency})`,
        ref: `tx:${r.id}`,
        href: r.case_id ? (cases.get(r.case_id) ?? null) : null,
        values: { amount: r.amount, abs: Math.abs(r.amount) },
        dims: { counterparty: r.counterparty, account: r.account, direction: r.amount < 0 ? "out" : "in" },
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const minutesOf = (s: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s);
  return m ? Date.parse(`${m[1]}T00:00:00Z`) / 60000 + +m[2] * 60 + +m[3] : null;
};

const calendarEvents: QueryView = {
  name: "calendar_events",
  plugin: "calendar",
  description:
    "Termine aller Kalender (Serien je Vorkommen): Beginn, Titel, Ort, Teilnehmer, Kalender, Dauer. Abgesagte und abgelehnte Termine zählen nicht (außer includeCancelled). Für „wie oft war ich im Büro“ (count_days mit location oder title), „wann zuletzt mit X getroffen“ (attendee/title, last), „wie viele Stunden Meetings“.",
  filters: {
    ...DATE_FILTERS,
    title: { type: "text", description: "Teil des Titels" },
    location: { type: "text", description: "Teil des Orts" },
    attendee: { type: "text", description: "ein Teilnehmer oder der Organisator (Teil von Name oder Adresse)" },
    calendar: { type: "text", description: "Kalender (Teil des Namens)" },
    text: { type: "text", description: "in Titel, Ort oder Beschreibung" },
    showAs: { type: "enum", values: ["busy", "free", "tentative", "oof", "workingElsewhere"], description: "wie der Termin die Zeit belegt" },
    allDay: { type: "boolean", description: "nur ganztägige (true) bzw. nur mit Uhrzeit (false)" },
    includeCancelled: { type: "boolean", description: "auch abgesagte und abgelehnte" },
  },
  dims: ["calendar", "title", "location", "showAs", "organizer"],
  measures: { hours: "Dauer in Stunden (ganztägige: 0)" },
  async items(f, ctx) {
    const { eventsBetween } = await import("@/lib/calendar/ir");
    const now = ctx.now ?? new Date();
    const from = typeof f.from === "string" ? f.from : `${now.getFullYear() - 5}-01-01`;
    const to = typeof f.to === "string" ? f.to : `${now.getFullYear() + 1}-12-31`;
    const title = str(f, "title");
    const location = str(f, "location");
    const attendee = str(f, "attendee");
    const calendar = str(f, "calendar");
    const text = str(f, "text");
    const showAs = str(f, "showAs");
    return eventsBetween(`${from}T00:00`, `${nextDay(to)}T00:00`)
      .filter(
        (e) =>
          (f.includeCancelled === true || (!e.cancelled && e.response !== "declined")) &&
          (!title || has(e.title, title)) &&
          (!location || has(e.location, location)) &&
          (!attendee || hasAny([e.organizer, ...e.attendees].join(" | "), [attendee])) &&
          (!calendar || has(e.calendar.name, calendar)) &&
          (!text || has(`${e.title} ${e.location} ${e.description}`, text)) &&
          (!showAs || e.showAs === showAs) &&
          (typeof f.allDay !== "boolean" || e.allDay === f.allDay),
      )
      .map((e): Item => {
        const a = minutesOf(e.start);
        const b = minutesOf(e.end);
        const day = e.start.slice(0, 10);
        return {
          at: e.start,
          title: `${e.title}${e.location ? ` (${e.location})` : ""}`,
          ref: `event:${e.id}${"occurrence" in e && e.occurrence ? `#${String(e.occurrence)}` : ""}`,
          href: `/kalender?v=day&d=${day}`,
          values: { hours: !e.allDay && a !== null && b !== null ? Math.round(((b - a) / 60) * 100) / 100 : 0 },
          dims: { calendar: e.calendar.name, title: e.title, location: e.location, showAs: e.showAs, organizer: e.organizer },
        };
      });
  },
};

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

type DRow = { id: number; ticket: string; text: string; kind: string; owner: string; status: string; created_at: string; done_at: string | null; due: string | null };

const todoView: QueryView = {
  name: "todos",
  plugin: "todos",
  description: "Die Todos (aus Jira, Mails, Chats, Notizen …): Ticket, Text, Status (open/done/dismissed), angelegt, erledigt, fällig. Für „wie viele Todos habe ich im Oktober erledigt“, „welche Tickets haben die meisten offenen Todos“.",
  filters: {
    ...DATE_FILTERS,
    dateField: { type: "enum", values: ["created", "done", "due"], description: "worauf sich from/to (und die Zeit-Gruppen) beziehen: angelegt (Standard), erledigt, fällig" },
    status: { type: "enum", values: ["open", "done", "dismissed"], description: "Status" },
    ticket: { type: "text", description: "Ticket-Key oder sein Anfang" },
    text: { type: "text", description: "Teil des Texts" },
    kind: { type: "text", description: "Art (kind)" },
    owner: { type: "text", description: "wer es tun soll (me oder ein Name)" },
  },
  dims: ["status", "ticket", "kind", "owner"],
  measures: {},
  items(f) {
    const field = str(f, "dateField") ?? "created";
    const status = str(f, "status");
    const ticket = str(f, "ticket");
    const text = str(f, "text");
    const kind = str(f, "kind");
    const owner = str(f, "owner");
    const from = fromOf(f);
    const to = toOf(f);
    return rows<DRow>("select id, ticket, text, kind, owner, status, created_at, done_at, due from todos where merged_into is null order by id")
      .map((r) => ({ r, at: (field === "done" ? r.done_at : field === "due" ? r.due : r.created_at) ?? "" }))
      .filter(({ r, at }) => at && at.slice(0, 10) >= from && at.slice(0, 10) <= to && (!status || r.status === status) && (!ticket || r.ticket.toUpperCase().startsWith(ticket.toUpperCase())) && (!text || has(r.text, text)) && (!kind || r.kind === kind) && (!owner || has(r.owner, owner)))
      .map(
        ({ r, at }): Item => ({
          at: at.replace(" ", "T"),
          title: `T-${r.id} ${r.ticket ? `${r.ticket} · ` : ""}${r.text}`,
          ref: `todo:${r.id}`,
          href: r.status === "open" ? `/todos#todo-${r.id}` : `/todos?todos=done#todo-${r.id}`,
          values: {},
          dims: { status: r.status, ticket: r.ticket, kind: r.kind, owner: r.owner },
        }),
      );
  },
};

// ---------------------------------------------------------------------------
// Mails and messages
// ---------------------------------------------------------------------------

type MRow = { key: string; conv_id: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string };
type TeamsRow = { key: string; sender_name: string | null; place: string | null; sent_at: string; text: string; link: string };

/** Whom a person filter means: the names (and chat names) and addresses of the people it names — or the words themselves. */
async function whoIs(q: string): Promise<{ names: Set<string>; emails: Set<string>; loose: string | null }> {
  const want = q.trim().toLowerCase();
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("people")) {
      const { listPeople, namesOf } = await import("@/plugins/people/store");
      const people = listPeople();
      const named = (exact: boolean) => people.filter((p) => namesOf(p).some((n) => (exact ? n.toLowerCase() === want : n.toLowerCase().includes(want))) || p.emails.some((e) => e.toLowerCase() === want));
      const hits = named(true).length ? named(true) : named(false);
      if (hits.length) return { names: new Set(hits.flatMap((p) => namesOf(p).map((n) => n.toLowerCase()))), emails: new Set(hits.flatMap((p) => p.emails.map((e) => e.toLowerCase()))), loose: null };
    }
  } catch {
    // no people kept
  }
  return { names: new Set([want]), emails: new Set(want.includes("@") ? [want] : []), loose: want };
}

const channelOf = (convId: string) => (convId.startsWith("wa:") ? "whatsapp" : convId.startsWith("sg:") ? "signal" : "mail");

const messages: QueryView = {
  name: "messages",
  description:
    "Mails, WhatsApp-, Signal- und Teams-Nachrichten (eingegangen und — in Chats — eigene): Zeitpunkt, Kanal, Absender, Chat, Betreff/Text. Für „wann zuletzt mit X geschrieben/gesprochen“ (person, last), „wie viele Mails von Y im Oktober“, „mit wem schreibe ich am meisten“ (groupBy chat).",
  filters: {
    ...DATE_FILTERS,
    person: { type: "text", description: "eine Person (Name, Alias oder Adresse): ihr Chat, ihre Mails, ihre Teams-Nachrichten" },
    channel: { type: "enum", values: ["mail", "whatsapp", "signal", "teams"], description: "Kanal" },
    sender: { type: "text", description: "Absender (Teil von Name oder Adresse)" },
    chat: { type: "text", description: "Chat bzw. Teams-Ort (Teil des Namens)" },
    text: { type: "text", description: "in Betreff oder Text" },
    direction: { type: "enum", values: ["in", "out"], description: "in: an mich, out: von mir (nur in Chats bekannt)" },
  },
  dims: ["channel", "sender", "chat", "direction"],
  measures: {},
  async items(f) {
    const from = fromOf(f);
    const to = toOf(f);
    const who = str(f, "person") ? await whoIs(str(f, "person")!) : null;
    const channel = str(f, "channel");
    const sender = str(f, "sender");
    const chat = str(f, "chat");
    const text = str(f, "text");
    const direction = str(f, "direction");
    const out: Item[] = [];
    if (channel !== "teams") {
      for (const m of rows<MRow>("select key, conv_id, folder, from_name, from_email, subject, preview, received_at from emails where substr(received_at, 1, 10) >= ? and substr(received_at, 1, 10) <= ? order by received_at", from, to)) {
        const ch = channelOf(m.conv_id);
        const chatName = ch === "mail" ? "" : m.conv_id.slice(3);
        const mine = (m.from_name ?? "") === "Ich";
        if (who) {
          const fromName = (m.from_name ?? "").toLowerCase();
          const theirs = (chatName && (who.names.has(chatName.toLowerCase()) || (who.loose !== null && chatName.toLowerCase().includes(who.loose)))) || who.emails.has((m.from_email ?? "").toLowerCase()) || who.names.has(fromName) || (who.loose !== null && fromName.includes(who.loose));
          if (!theirs) continue;
        }
        if ((channel && ch !== channel) || (sender && !has(`${m.from_name ?? ""} ${m.from_email ?? ""}`, sender)) || (chat && !has(chatName || m.from_name, chat)) || (text && !has(`${m.subject} ${m.preview}`, text)) || (direction && (direction === "out") !== mine)) continue;
        const what = ch === "mail" ? m.subject || m.preview.slice(0, 80) : m.preview.slice(0, 80);
        out.push({
          at: m.received_at,
          title: `${ch === "mail" ? "Mail" : ch === "whatsapp" ? "WhatsApp" : "Signal"}${chatName ? ` „${chatName}“` : ""} · ${m.from_name ?? m.from_email ?? "?"}: ${what}`,
          ref: `mail:${m.key}`,
          href: `/mail?q=${encodeURIComponent(chatName || m.subject || m.from_email || "")}`,
          values: {},
          dims: { channel: ch, sender: m.from_name ?? m.from_email ?? "", chat: chatName || (m.from_name ?? m.from_email ?? ""), direction: mine ? "out" : "in" },
        });
      }
    }
    if (!channel || channel === "teams") {
      for (const m of rows<TeamsRow>("select key, sender_name, place, sent_at, text, link from teams_messages where substr(sent_at, 1, 10) >= ? and substr(sent_at, 1, 10) <= ? order by sent_at", from, to)) {
        const name = (m.sender_name ?? "").toLowerCase();
        if (who && !who.names.has(name) && !(who.loose !== null && name.includes(who.loose))) continue;
        if ((sender && !has(m.sender_name, sender)) || (chat && !has(m.place, chat)) || (text && !has(m.text, text)) || direction === "out") continue;
        out.push({
          at: m.sent_at,
          title: `Teams${m.place ? ` · ${m.place}` : ""} · ${m.sender_name ?? "?"}: ${m.text.slice(0, 80)}`,
          ref: `msg:teams:${m.key}`,
          href: m.link || null,
          values: {},
          dims: { channel: "teams", sender: m.sender_name ?? "", chat: m.place ?? m.sender_name ?? "", direction: "in" },
        });
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Workspace databases
// ---------------------------------------------------------------------------

/** A condition on a row's cell texts and numbers. */
function passes(c: Condition, text: string, num: number | undefined): boolean {
  const t = text.toLowerCase();
  const w = (c.value ?? "").toLowerCase();
  const n = Number(c.value);
  const cmp = num !== undefined && Number.isFinite(n) ? num - n : t.localeCompare(w);
  switch (c.op) {
    case "contains":
      return t.includes(w);
    case "is":
      return t === w;
    case "is_not":
      return t !== w;
    case "empty":
      return !t;
    case "not_empty":
      return !!t;
    case "gt":
      return cmp > 0;
    case "lt":
      return cmp < 0;
    case "gte":
      return cmp >= 0;
    case "lte":
      return cmp <= 0;
  }
}

const workspaceView: QueryView = {
  name: "workspace",
  plugin: "workspace",
  dynamic: true,
  description:
    "Eine Datenbank des Workspace (Tabellen wie Ausgaben, Journal, Schulden, Vorgänge …), Zeile für Zeile: groupBy und measure sind Namen ihrer Eigenschaften (measure: eine Zahl-Eigenschaft), die Zeit ist ihre Datums-Eigenschaft (dateProp, sonst die erste, sonst angelegt). Welche Datenbanken es gibt, steht unten.",
  filters: {
    database: { type: "text", required: true, description: "die Datenbank: ihre id oder ihr Titel" },
    ...DATE_FILTERS,
    dateProp: { type: "text", description: "die Datums-Eigenschaft, auf die sich from/to und die Zeit-Gruppen beziehen" },
    contains: { type: "text", description: "Titel oder irgendeine Zelle enthält das" },
    where: { type: "conditions", description: "Bedingungen auf Eigenschaften: [{prop, op: contains|is|is_not|gt|lt|gte|lte|empty|not_empty, value}] — select-Werte mit ihrem Namen" },
  },
  dims: [],
  measures: {},
  async items(f) {
    const store = await import("@/plugins/workspace/store");
    const { cellText, dateRange } = await import("@/plugins/workspace/model");
    const ref = String(f.database ?? "").trim();
    const byId = /^#?(\d+)$/.exec(ref);
    const page = byId ? store.getPage(Number(byId[1])) : (() => {
      const hits = store.suggestPages(ref, 8).filter((h) => h.kind === "database");
      const pick = hits.find((h) => h.title.toLowerCase() === ref.toLowerCase()) ?? hits[0];
      return pick ? store.getPage(pick.id) : null;
    })();
    const d = page && page.kind === "database" ? store.rowsOf(page.id) : null;
    if (!page || !d) {
      const { ValidationError } = await import("@/lib/errors");
      throw new ValidationError(`No Workspace database "${ref}".`);
    }
    const labels = store.labelFns(await store.labelsFor(d.schema, d.rows));
    const props = d.schema.properties;
    const dateName = str(f, "dateProp");
    const dateProp = dateName ? props.find((p) => p.name.toLowerCase() === dateName.toLowerCase() && (p.type === "date" || p.type === "created_time" || p.type === "updated_time")) : props.find((p) => p.type === "date");
    if (dateName && !dateProp) {
      const { ValidationError } = await import("@/lib/errors");
      throw new ValidationError(`No date property "${dateName}" — the date properties: ${props.filter((p) => p.type === "date").map((p) => p.name).join(", ") || "none"}.`);
    }
    const contains = str(f, "contains");
    const conds = Array.isArray(f.where) ? (f.where as Condition[]) : [];
    const from = fromOf(f);
    const to = toOf(f);
    const out: Item[] = [];
    for (const r of d.rows) {
      const dims: Record<string, string> = {};
      const values: Record<string, number> = {};
      for (const p of props) {
        const v = r.cells[p.id];
        dims[p.name] = cellText(p, v, labels);
        if (typeof v === "number" && Number.isFinite(v)) values[p.name] = v;
      }
      const at = dateProp ? (dateProp.type === "date" ? (dateRange(r.cells[dateProp.id])?.start ?? "") : dateProp.type === "created_time" ? r.createdAt : r.updatedAt) : r.createdAt;
      if ((from !== MIN_DAY || to !== MAX_DAY) && (!at || at.slice(0, 10) < from || at.slice(0, 10) > to)) continue;
      if (contains && !has(r.title, contains) && !Object.values(dims).some((x) => has(x, contains))) continue;
      const ok = conds.every((c) => {
        const name = c.prop.toLowerCase();
        if (name === d.schema.titleName.toLowerCase() || name === "title") return passes(c, r.title, undefined);
        const p = props.find((x) => x.name.toLowerCase() === name);
        return p ? passes(c, dims[p.name] ?? "", values[p.name]) : false;
      });
      if (!ok) continue;
      out.push({ at: at || r.createdAt, title: r.title || "Untitled", ref: `page:${r.id}`, href: `/workspace/${r.id}`, values, dims });
    }
    const unknown = conds.find((c) => c.prop.toLowerCase() !== "title" && c.prop.toLowerCase() !== d.schema.titleName.toLowerCase() && !props.some((p) => p.name.toLowerCase() === c.prop.toLowerCase()));
    if (unknown) {
      const { ValidationError } = await import("@/lib/errors");
      throw new ValidationError(`No property "${unknown.prop}" in ${page.title} — its properties: ${[d.schema.titleName, ...props.map((p) => p.name)].join(", ")}.`);
    }
    return out;
  },
};

/** The Workspace's databases for the planner: id, title and properties (name:type) — the system's own left out. */
export function workspaceDatabases(limit = 60): { id: number; title: string; props: string }[] {
  type W = { id: number; title: string; schema: string | null };
  return rows<W>("select id, title, schema from ws_pages where kind = 'database' and archived_at is null and template = 0 order by updated_at desc limit ?", limit * 2)
    .map((w) => {
      try {
        const s = JSON.parse(w.schema ?? "{}") as { titleName?: string; properties?: { name: string; type: string }[] };
        return { id: w.id, title: w.title, props: [`${s.titleName ?? "Name"}:title`, ...(s.properties ?? []).map((p) => `${p.name}:${p.type}`)].join(", ") };
      } catch {
        return { id: w.id, title: w.title, props: "" };
      }
    })
    .filter((w) => w.title && !/^(System|Prompts)$/i.test(w.title))
    .slice(0, limit);
}

export const BUILTIN_VIEWS: QueryView[] = [timeEntries, bankTransactions, calendarEvents, todoView, messages, workspaceView];
