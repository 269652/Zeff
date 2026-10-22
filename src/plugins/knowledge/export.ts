import { isoDay } from "@/lib/text";
import { bankDocs } from "@/plugins/finances/knowledge-docs";
import { getSqlite } from "@/db";
import { currentAccount } from "@/db/accounts";
import { weekFromDate } from "@/lib/week";
import { collectionItems, knowledgeItems, listCollections } from "@/lib/items";
import { documentDocs } from "@/plugins/documents/export";
import { isInstalled } from "@/plugins/state";
import { pushTo } from "@/lib/collections";
import { backfillReports } from "@/lib/work/report";
import { branchKnowledgeDocs } from "@/lib/work/branch-knowledge";

/**
 * Zeff's synced context as documents for the knowledge server (its "Zeff" source): Jira tickets
 * with their comments, Teams chats by day, mail conversations, GitLab merge requests with their
 * comments, todos with their notes and AI reports (and the workers' full reports), the time entries by week, the day recaps, the
 * notes, the Google Keep notes. Each with a version (a hash of its text — unchanged ones aren't compiled again) and,
 * where there is one, a link (Jira, Teams, GitLab, or the page in Zeff).
 */

export type KnowledgeDoc = { id: string; space: string; title: string; url: string; version: number; updatedAt: string | null; author: string | null; body: string };

/** A text's version: a 31-bit hash (FNV-1a). */
function version(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

const day = (t: string | null | undefined) => (t ? t.slice(0, 10) : "");
const time = (t: string | null | undefined) => (t && t.length >= 16 ? t.slice(11, 16) : "");
const clean = (t: string | null | undefined) => (t ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
const json = <T>(t: string | null | undefined, d: T): T => {
  try {
    return t ? (JSON.parse(t) as T) : d;
  } catch {
    return d;
  }
};

function doc(d: Omit<KnowledgeDoc, "version">): KnowledgeDoc {
  return { ...d, version: version(`${d.title}\n${d.body}`) };
}

/** What an item is, by its kind (the documents' first line). */
const KIND_DE = { card: "Karte", note: "Notiz", row: "Eintrag" } as const;

/**
 * What you keep (Keep boards, Google Keep, Workspace databases …) as documents: the items of the
 * collections in the knowledge, archived ones too — one each, in its collection's space.
 * `plugin`: one plugin's only.
 */
export function collectionDocs(plugin?: string, ids?: Set<string>): KnowledgeDoc[] {
  // Picked by the knowledge server (its ids): those collections, whatever their old switch; else the switch's.
  const placed = ids ? listCollections().filter((c) => ids.has(c.id)).flatMap((collection) => (collectionItems(collection.id, { archived: true }) ?? []).map((item) => ({ item, collection }))) : knowledgeItems(plugin ? { plugin } : {});
  return placed
    .filter(({ item: n }) => n.title || n.text)
    .map(({ item: n, collection: c }) => {
      // (A row with fields has its status and labels among them, by their names.)
      const own = !n.fields?.length;
      const meta = [`${KIND_DE[n.kind]} in „${c.name}“`, own && n.status ? `Status: ${n.status.name}` : "", own && n.labels.length ? `Labels: ${n.labels.join(", ")}` : "", n.pinned ? "angeheftet" : "", n.archived ? "archiviert" : ""].filter(Boolean).join(" · ");
      return doc({
        id: n.ref,
        space: c.space ?? c.name,
        title: n.title || n.text.split("\n")[0].slice(0, 100) || KIND_DE[n.kind],
        url: /^https?:/.test(n.href) ? n.href : "",
        updatedAt: n.updatedAt ?? n.createdAt,
        author: null,
        // (A database row's fields under it, one a line: a journal's day keeps its date, mood, energy.)
        body: `${[meta, ...(n.fields ?? []).map((f) => `${f.name}: ${clean(f.value)}`)].join("\n")}\n\n${clean(n.text)}`,
      });
    });
}

/** `only: "keep"`: just Google Keep's notes (the knowledge server's own Google Keep source). */
export function knowledgeDocs(zeffUrl: string, only?: "keep", include?: string[]): { account: string; docs: KnowledgeDoc[] } {
  if (only === "keep") return { account: currentAccount().name, docs: [...collectionDocs("keep"), ...collectionDocs("notes")] };
  const db = getSqlite();
  const all = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];
  const docs: KnowledgeDoc[] = [];

  // Jira: each ticket with its description and comments.
  const comments = new Map<string, { author: string; at: string; body: string }[]>();
  for (const c of all<{ ticket: string; author: string; at: string; body: string }>("select ticket, author, at, body from jira_comments order by at")) {
    const k = c.ticket.toUpperCase();
    pushTo(comments, k, c);
  }
  for (const t of all<{ key: string; summary: string; status: string; issue_type: string | null; priority: string | null; assignee: string | null; url: string | null; updated_at: string | null; description: string | null; job_number: string | null }>(
    "select key, summary, status, issue_type, priority, assignee, url, updated_at, description, job_number from jira_tickets",
  )) {
    const cs = comments.get(t.key.toUpperCase()) ?? [];
    if (!clean(t.description) && !cs.length && !t.summary) continue;
    const body = [
      `Ticket ${t.key}: ${t.summary}`,
      `Status: ${t.status}${t.issue_type ? ` · Typ: ${t.issue_type}` : ""}${t.priority ? ` · Priorität: ${t.priority}` : ""}${t.assignee ? ` · Zuständig: ${t.assignee}` : ""}${t.job_number ? ` · Job: ${t.job_number}` : ""}`,
      clean(t.description) && `## Beschreibung\n${clean(t.description)}`,
      cs.length && `## Kommentare\n${cs.map((c) => `- ${c.author} (${day(c.at)}): ${clean(c.body)}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    docs.push(doc({ id: `zeff:jira:${t.key}`, space: "Zeff · Jira", title: `${t.key}: ${t.summary}`, url: t.url ?? "", updatedAt: t.updated_at, author: t.assignee, body }));
  }

  // Teams: a chat (or channel) by day.
  const teams = new Map<string, { place: string; day: string; link: string; lines: string[]; last: string }>();
  for (const m of all<{ conversation_id: string | null; place: string | null; sender_name: string | null; sent_at: string; subject: string | null; text: string | null; link: string | null }>(
    "select conversation_id, place, sender_name, sent_at, subject, text, link from teams_messages order by sent_at",
  )) {
    const key = `${m.conversation_id ?? m.place ?? "teams"}:${day(m.sent_at)}`;
    const g = teams.get(key) ?? { place: m.place ?? "Teams", day: day(m.sent_at), link: m.link ?? "", lines: [], last: m.sent_at };
    g.lines.push(`- ${time(m.sent_at)} ${m.sender_name ?? "?"}: ${[m.subject, clean(m.text)].filter(Boolean).join(" — ")}`);
    g.last = m.sent_at;
    teams.set(key, g);
  }
  for (const [key, g] of teams)
    docs.push(doc({ id: `zeff:teams:${key}`, space: "Zeff · Teams", title: `Teams · ${g.place} · ${g.day}`, url: g.link, updatedAt: g.last, author: null, body: `Teams-Nachrichten in „${g.place}“ am ${g.day}:\n${g.lines.join("\n")}` }));

  // Mail: a conversation.
  const mails = new Map<string, { subject: string; lines: string[]; last: string }>();
  for (const m of all<{ key: string; conv_id: string | null; from_name: string | null; from_email: string | null; subject: string | null; preview: string | null; received_at: string; folder: string | null }>(
    "select key, conv_id, from_name, from_email, subject, preview, received_at, folder from emails order by received_at",
  )) {
    const key = m.conv_id || m.key;
    const g = mails.get(key) ?? { subject: m.subject ?? "(ohne Betreff)", lines: [], last: m.received_at };
    g.lines.push(`- ${day(m.received_at)} ${time(m.received_at)} ${m.from_name ?? m.from_email ?? "?"}${m.folder ? ` [${m.folder}]` : ""}: ${clean(m.preview)}`);
    g.last = m.received_at;
    mails.set(key, g);
  }
  for (const [key, g] of mails) {
    const app = key.startsWith("wa:") ? "WhatsApp" : key.startsWith("sg:") ? "Signal" : null;
    if (!app) {
      docs.push(doc({ id: `zeff:mail:${key}`, space: "Zeff · Mail", title: `Mail · ${g.subject}`, url: "", updatedAt: g.last, author: null, body: `Mail-Verlauf „${g.subject}“:\n${g.lines.join("\n")}` }));
      continue;
    }
    // A chat (WhatsApp, Signal): a page per month (a whole history loaded is long — and a new message then
    // changes only its month's page, not all of it).
    const months = new Map<string, string[]>();
    for (const l of g.lines) {
      const month = /^- (\d{4}-\d{2})/.exec(l)?.[1] ?? "";
      pushTo(months, month, l);
    }
    for (const [month, lines] of months)
      docs.push(
        doc({
          id: `zeff:mail:${key}${month ? `:${month}` : ""}`,
          space: `Zeff · ${app}`,
          title: `${app} · ${g.subject}${month ? ` · ${month}` : ""}`,
          url: "",
          updatedAt: lines.length ? /^- (\S+)/.exec(lines[lines.length - 1])?.[1] ?? g.last : g.last,
          author: null,
          body: `${app}-Chat mit „${g.subject}“${month ? `, ${month}` : ""} („Ich“ bin ich):\n${lines.join("\n")}`,
        }),
      );
  }

  // GitLab: a merge request (or issue, branch) with its comments.
  type G = { key: string; kind: string; project: string; ref: string | null; title: string | null; body: string | null; author: string | null; state: string | null; created_at: string | null; updated_at: string | null; url: string | null; branch: string | null; parent: string | null };
  const items = all<G>("select key, kind, project, ref, title, body, author, state, created_at, updated_at, url, branch, parent from gitlab_items order by created_at");
  const byParent = new Map<string, G[]>();
  for (const g of items) if (g.kind === "comment" && g.parent) pushTo(byParent, g.parent, g);
  for (const g of items) {
    if (g.kind === "comment" && g.parent && items.some((x) => x.key === g.parent)) continue; // with its merge request
    const cs = byParent.get(g.key) ?? [];
    const body = [
      `${g.kind === "comment" ? "Kommentar" : g.kind} ${g.ref ?? ""} ${g.title ?? ""} — ${g.project}${g.state ? ` (${g.state})` : ""}${g.branch ? ` · Branch ${g.branch}` : ""}${g.author ? ` · von ${g.author}` : ""}`,
      clean(g.body),
      cs.length && `## Kommentare\n${cs.map((c) => `- ${c.author ?? "?"} (${day(c.created_at)}): ${clean(c.body)}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    docs.push(doc({ id: `zeff:gitlab:${g.key}`, space: "Zeff · GitLab", title: `GitLab · ${g.ref ?? ""} ${g.title ?? g.kind}`.trim(), url: g.url ?? "", updatedAt: g.updated_at ?? g.created_at, author: g.author, body }));
  }

  // Todos: each with its note, your notes and the AI reports, what happened to it.
  const events = new Map<number, string[]>();
  for (const e of all<{ todo_id: number; event: string; text: string | null; note: string | null; actor: string | null; at: string }>("select todo_id, event, text, note, actor, at from todo_events order by at"))
    pushTo(events, e.todo_id, `- ${day(e.at)} ${e.event}${e.actor ? ` (${e.actor})` : ""}${e.note ? `: ${clean(e.note)}` : ""}`);
  for (const t of all<{ id: number; ticket: string; also_tickets: string | null; text: string; kind: string; owner: string; status: string; note: string | null; user_notes: string | null; created_at: string; updated_at: string | null; done_at: string | null }>(
    "select id, ticket, also_tickets, text, kind, owner, status, note, user_notes, created_at, updated_at, done_at from todos",
  )) {
    const notes = json<{ at: string; text: string; by?: string; kind?: string }[]>(t.user_notes, []);
    const tickets = [t.ticket, ...json<string[]>(t.also_tickets, [])].filter(Boolean);
    const body = [
      `Todo T-${t.id}${tickets.length ? ` zu ${tickets.join(", ")}` : ""}: ${t.text}`,
      `Art: ${t.kind} · ${t.owner === "other" ? "wartet auf andere" : "meins"} · Status: ${t.status}${t.done_at ? ` (erledigt ${day(t.done_at)})` : ""}`,
      clean(t.note) && `Notiz: ${clean(t.note)}`,
      notes.length && `## Notizen und KI-Berichte\n${notes.map((n) => `- ${day(n.at)} ${n.kind === "instruction" ? "Anweisung" : n.by ? `Bericht (${n.by})` : "Notiz"}: ${clean(n.text)}`).join("\n")}`,
      events.get(t.id)?.length && `## Verlauf\n${events.get(t.id)!.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    docs.push(doc({ id: `zeff:todo:${t.id}`, space: "Zeff · Todos", title: `T-${t.id}${t.ticket ? ` · ${t.ticket}` : ""}: ${t.text.slice(0, 120)}`, url: `${zeffUrl}/t/${t.id}`, updatedAt: t.updated_at ?? t.created_at, author: null, body }));
  }

  // Work reports: what a worker did on a todo, whole (the runs from before they were kept get theirs first) (the todo's own page has only its cut-short comment).
  backfillReports();
  for (const r of all<{ id: number; run_id: number; todo_id: number; ticket: string; title: string; body: string; by_who: string; created_at: string; updated_at: string }>(
    "select id, run_id, todo_id, ticket, title, body, by_who, created_at, updated_at from work_reports",
  ))
    docs.push(doc({ id: `zeff:report:${r.id}`, space: "Zeff · Berichte", title: `Bericht W-${r.run_id} zu T-${r.todo_id}${r.ticket ? ` · ${r.ticket}` : ""}: ${r.title.slice(0, 120)}`, url: `${zeffUrl}/t/${r.todo_id}`, updatedAt: r.updated_at ?? r.created_at, author: r.by_who, body: `Bericht von ${r.by_who} zu Todo T-${r.todo_id}${r.ticket ? ` (${r.ticket})` : ""}, ${day(r.created_at)}.

${clean(r.body)}` }));

  // Branch knowledge: each todo with a ticket and the messages it comes from, kept and tagged — read by the workers that name branches.
  for (const b of branchKnowledgeDocs(zeffUrl)) docs.push(doc(b));

  // Time entries: a week each (Monday).
  const weeks = new Map<string, string[]>();
  for (const e of all<{ id: number; date: string; hours: number; description: string; ticket: string | null; type: string | null; number: string | null; name: string | null }>(
    "select e.id, e.date, e.hours, e.description, e.ticket, e.type, j.number, j.name from time_entries e left join jobs j on j.id = e.job_id order by e.date",
  )) {
    const d = new Date(`${e.date}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const monday = isoDay(d);
    pushTo(weeks, monday, `- ${e.date} · ${e.hours} h · ${e.number ?? "?"} ${e.name ?? ""}${e.ticket ? ` · ${e.ticket}` : ""}${e.type ? ` · ${e.type}` : ""}: ${clean(e.description)}`);
  }
  for (const [monday, lines] of weeks)
    docs.push(doc({ id: `zeff:week:${monday}`, space: "Zeff · Zeiterfassung", title: `Gebuchte Zeiten, Woche ab ${monday}`, url: `${zeffUrl}/?week=${weekFromDate(new Date(`${monday}T00:00:00`)).key}`, updatedAt: monday, author: null, body: `Gebuchte Arbeitszeiten der Woche ab ${monday}:\n${lines.join("\n")}` }));

  // Day recaps: what a workday held.
  for (const r of all<{ day: string; result: string | null }>("select day, result from day_recaps where status = 'ok' and result is not null")) {
    const v = json<Record<string, unknown>>(r.result, {});
    // Its summary, and what it says per ticket and besides.
    const text = [
      typeof v.summary === "string" ? v.summary : "",
      v.tickets ? `## Tickets\n${JSON.stringify(v.tickets, null, 1)}` : "",
      v.other ? `## Sonstiges\n${JSON.stringify(v.other, null, 1)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    docs.push(doc({ id: `zeff:recap:${r.day}`, space: "Zeff · Tagesrückblick", title: `Tagesrückblick ${r.day}`, url: "", updatedAt: r.day, author: null, body: clean(text) }));
  }

  // Notes and context items (your notes, the synced ones' text).
  for (const c of all<{ id: number; kind: string; title: string | null; author: string | null; body: string | null; date: string | null; ticket: string | null; updated_at: string | null }>(
    "select id, kind, title, author, body, date, ticket, updated_at from contexts where length(coalesce(body, '')) > 40",
  ))
    docs.push(doc({ id: `zeff:context:${c.id}`, space: "Zeff · Notizen", title: c.title || `${c.kind}${c.ticket ? ` zu ${c.ticket}` : ""} ${c.date ?? ""}`.trim(), url: "", updatedAt: c.updated_at ?? c.date, author: c.author, body: `${c.ticket ? `Zu ${c.ticket}. ` : ""}${clean(c.body)}` }));

  // Google Keep's notes.
  const pick = include ? new Set(include) : null;
  docs.push(...collectionDocs(undefined, pick ? new Set(include!.filter((x) => !x.startsWith("space:"))) : undefined));

  // Facts the Mail-Durchsicht found in your messages ("Nadines Geburtstag: 16.10.") — each its own page.
  for (const f of all<{ id: number; subject: string; text: string; updated_at: string }>("select id, subject, text, updated_at from facts"))
    docs.push(doc({ id: `zeff:fact:${f.id}`, space: "Zeff · Fakten", title: f.subject, url: "", updatedAt: f.updated_at, author: null, body: `${f.subject}: ${clean(f.text)}` }));

  // The Documents plugin's files (their text read) — compiled to abstracts, searchable, context for todos.
  if (isInstalled("documents")) docs.push(...documentDocs(zeffUrl));

  // The bank statements (the Cases plugin's bank): a page per account and month — the knowledge keeps your income from them.
  if (isInstalled("finances")) docs.push(...bankDocs());

  if (pick) {
    // The sources picked (by their space); the collections were picked above.
    const collections = new Set(listCollections().map((c) => c.space ?? c.name));
    return { account: currentAccount().name, docs: docs.filter((d) => pick.has(`space:${d.space}`) || (collections.has(d.space) && !d.id.startsWith("zeff:"))) };
  }
  return { account: currentAccount().name, docs };
}

export type CatalogEntry = { id: string; name: string; kind: "source" | "database"; count: number; /** In the export when nothing is picked (as before). */ selected: boolean };

/**
 * What the knowledge server can pick from Zeff: each source as its space ("Zeff · Jira" — with how many pages), each
 * collection of the Workspace, Keep, Kanban (with how many items; selected: its old "in the knowledge" switch).
 */
export function knowledgeCatalog(): CatalogEntry[] {
  const spaces = new Map<string, number>();
  const collections = new Set(listCollections().map((c) => c.space ?? c.name));
  for (const d of knowledgeDocs("").docs) if (d.id.startsWith("zeff:") || !collections.has(d.space)) spaces.set(d.space, (spaces.get(d.space) ?? 0) + 1);
  const sources: CatalogEntry[] = [...spaces.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([space, count]) => ({ id: `space:${space}`, name: space.replace(/^Zeff · /, ""), kind: "source", count, selected: true }));
  const dbs: CatalogEntry[] = listCollections().map((c) => ({ id: c.id, name: c.name, kind: "database", count: (collectionItems(c.id) ?? []).length, selected: !!c.knowledge }));
  return [...sources, ...dbs];
}
