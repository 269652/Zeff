import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentAccountId } from "@/db/accounts";
import { ATTENTION_LABELS, isAttention } from "@/lib/boards/shared";
import { lageByTicket, openTodosByTicket, type Lage } from "@/lib/boards/ticket-lage";
import type { BoardSummary, RichBoard, RichCard, RichColumn } from "@/plugins/kanban/shared";

/**
 * Jira Lage (built on Kanban): your Jira boards as Kanban boards — their columns as Jira has them
 * (the board's configuration), each ticket a card with what the Lage run made of it: how it
 * stands (attention, the headline, the summary), what happened lately, the open todos, the flags
 * and the actions it suggests. And "Meine Lage": the tickets of the Lage run itself.
 */

const { jiraBoards, jiraTickets, jiraComments, syncState } = schema;

/** The Board-Lage: running now, and its last run (as the Sync menu keeps it). */
function boardLageState(): RichBoard["boardLage"] {
  const r = getDb().select().from(syncState).where(eq(syncState.key, "boardlage")).get();
  return { running: !!(globalThis as { __zeffBoardLage?: unknown }).__zeffBoardLage, lastAt: r?.lastAt ?? null, lastOk: r?.lastOk ?? null, lastMessage: r?.lastMessage ?? null };
}

type JiraColumn = { name: string; statuses: string[] };
const cache = globalThis as unknown as { __zeffJiraColumns?: Map<string, { at: number; columns: JiraColumn[] | null; error?: string }>; __zeffJiraStatuses?: { at: number; names: Map<string, string> } };
const columnsCache = (cache.__zeffJiraColumns ??= new Map());
const HOUR = 3600000;

function jiraRest(): { base: string; headers: Record<string, string> } | null {
  const base = process.env.JIRA_URL?.replace(/\/+$/, "");
  const token = process.env.JIRA_PERSONAL_TOKEN;
  return base && token ? { base, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } } : null;
}

/** Jira's statuses by id → name (an hour). */
async function statusNames(): Promise<Map<string, string>> {
  const hit = cache.__zeffJiraStatuses;
  if (hit && Date.now() - hit.at < HOUR) return hit.names;
  const j = jiraRest();
  if (!j) return new Map();
  const r = await fetch(`${j.base}/rest/api/2/status`, { headers: j.headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Jira ${r.status}`);
  const names = new Map(((await r.json()) as { id: string; name: string }[]).map((s) => [String(s.id), s.name]));
  cache.__zeffJiraStatuses = { at: Date.now(), names };
  return names;
}

/** A board's columns as Jira has them — each with the status names it holds (an hour; null: not to be had). */
async function boardColumns(boardId: number): Promise<{ columns: JiraColumn[] | null; error?: string }> {
  const key = `${currentAccountId()}:${boardId}`;
  const hit = columnsCache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit;
  const j = jiraRest();
  let out: { columns: JiraColumn[] | null; error?: string };
  if (!j) out = { columns: null, error: "Jira-Zugang (JIRA_URL, JIRA_PERSONAL_TOKEN) fehlt — Spalten nach Status-Kategorie." };
  else {
    try {
      const [names, r] = await Promise.all([statusNames(), fetch(`${j.base}/rest/agile/1.0/board/${boardId}/configuration`, { headers: j.headers, signal: AbortSignal.timeout(15000) })]);
      if (!r.ok) throw new Error(`Jira ${r.status}`);
      const cfg = (await r.json()) as { columnConfig?: { columns?: { name: string; statuses?: { id: string }[] }[] } };
      const cols = (cfg.columnConfig?.columns ?? []).map((c) => ({ name: c.name.trim(), statuses: (c.statuses ?? []).map((s) => names.get(String(s.id)) ?? "").filter(Boolean) }));
      out = { columns: cols.length ? cols : null };
    } catch (e) {
      out = { columns: null, error: `Spalten von Jira nicht lesbar (${e instanceof Error ? e.message : e}) — nach Status-Kategorie.` };
    }
  }
  columnsCache.set(key, { at: Date.now(), ...out });
  return out;
}

const CATEGORY_COLUMNS: JiraColumn[] = [
  { name: "Zu erledigen", statuses: [] },
  { name: "In Arbeit", statuses: [] },
  { name: "Erledigt", statuses: [] },
];
const categoryIndex = (c: string | null | undefined) => (c === "done" ? 2 : c === "inprogress" ? 1 : 0);


type Ticket = { key: string; summary: string; status: string; statusCategory: string | null; issueType: string | null; priority: string | null; assignee: string | null; url: string | null; updatedAt: string | null; people?: string[] };

const ATTENTION_ORDER = ["feedback", "blocked", "active", "check", "spec", "ready", "stale"];

type Activity = RichCard["activity"];

/** Without a Lage: what happened is the ticket's newest Jira comments (as synced), oldest first. */
function commentActivity(keys: string[]): Map<string, Activity> {
  const out = new Map<string, Activity>();
  if (!keys.length) return out;
  const rows = getDb().select().from(jiraComments).orderBy(desc(jiraComments.at)).all();
  const wanted = new Set(keys.map((k) => k.toUpperCase()));
  for (const c of rows) {
    const k = c.ticket.toUpperCase();
    if (!wanted.has(k)) continue;
    const list = out.get(k) ?? [];
    if (list.length >= 3) continue;
    const text = c.body.replace(/\s+/g, " ").trim();
    list.unshift({ when: new Date(c.at).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" }), who: c.author, what: text.length > 220 ? `${text.slice(0, 219)}…` : text });
    out.set(k, list);
  }
  return out;
}

function card(t: Ticket, lage: Lage | undefined, todos: Map<string, { id: number; text: string; owner: "me" | "other" }[]>, comments?: Map<string, Activity>): RichCard {
  const badges: RichCard["badges"] = [];
  if (t.issueType) badges.push({ text: t.issueType, tone: /bug|fehler/i.test(t.issueType) ? "red" : "zinc" });
  if (t.priority && /high|hoch|critical|kritisch|blocker|highest/i.test(t.priority)) badges.push({ text: t.priority, tone: "amber" });
  const attention = lage && isAttention(lage.attention) ? lage.attention : null;
  return {
    id: t.key,
    ref: t.key,
    title: t.summary,
    url: t.url,
    attention,
    attentionLabel: attention ? ATTENTION_LABELS[attention] : null,
    badges,
    // Jira's "Unassigned" is nobody.
    assignee: t.assignee && !/^(unassigned|nicht zugewiesen|nicht zugeordnet)$/i.test(t.assignee.trim()) ? t.assignee : null,
    lead: lage?.lead ?? null,
    summary: lage?.summary ?? null,
    activity: lage ? (lage.happened ?? []).slice(-6) : (comments?.get(t.key.toUpperCase()) ?? []),
    todos: todos.get(t.key.toUpperCase()) ?? [],
    flags: lage?.flags ?? [],
    actions: (lage?.actions ?? []).map((a) => ({ label: a.label, why: a.why })),
    people: t.people ?? [],
    updatedAt: t.updatedAt,
    noLage: !lage,
  };
}

function place(tickets: Ticket[], cols: JiraColumn[] | null, byKey: Map<string, Lage>, todos: Map<string, { id: number; text: string; owner: "me" | "other" }[]>): RichColumn[] {
  const comments = commentActivity(tickets.filter((t) => !byKey.has(t.key.toUpperCase())).map((t) => t.key));
  const list = cols ?? CATEGORY_COLUMNS;
  const columns: RichColumn[] = list.map((c, i) => ({ id: `c${i}`, name: c.name, cards: [] }));
  const other: RichColumn = { id: "other", name: "Sonstige", cards: [] };
  for (const t of tickets) {
    const i = cols ? cols.findIndex((c) => c.statuses.some((s) => s.toLowerCase() === t.status.toLowerCase())) : categoryIndex(t.statusCategory);
    (i >= 0 ? columns[i] : other).cards.push(card(t, byKey.get(t.key.toUpperCase()), todos, comments));
  }
  // Most pressing first: by the Lage's attention, then the newest change.
  const rank = (c: RichCard) => (c.attention ? ATTENTION_ORDER.indexOf(c.attention) : 99);
  for (const c of [...columns, other]) c.cards.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return other.cards.length ? [...columns, other] : columns;
}


/** The boards Jira Lage brings: "Meine Lage" and each Jira board chosen on the Jira page. */
export function lageBoards(): BoardSummary[] {
  const counts = getDb()
    .select({ board: jiraTickets.boardId, resolved: jiraTickets.resolvedAt })
    .from(jiraTickets)
    .all();
  const open = (id: number) => counts.filter((c) => c.board === id && !c.resolved).length;
  const { tickets, at } = lageByTicket();
  return [
    { id: "jira-lage", name: "Meine Lage", description: "Die Tickets des Lage-Laufs — jedes mit seiner Lage.", color: "violet", source: "Jira Lage", cards: tickets.length, open: tickets.filter((t) => t.statusCategory !== "done").length, href: "/kanban/jira-lage", updatedAt: at },
    ...getDb()
      .select()
      .from(jiraBoards)
      .where(eq(jiraBoards.enabled, true))
      .all()
      .map((b) => ({ id: `jira-${b.id}`, name: b.name, description: `Jira-Board${b.projectKey ? ` · ${b.projectKey}` : ""} — gespiegelt, mit der Lage je Ticket.`, color: "sky", source: "Jira Lage", cards: open(b.id), open: open(b.id), href: `/kanban/jira-${b.id}`, updatedAt: b.syncedAt })),
  ];
}

/** Done tickets on a board: those resolved in the last two weeks. */
const RECENT_DONE = 14 * 86400000;

export async function lageBoard(id: string): Promise<RichBoard | null> {
  const { byKey, tickets: lageTickets, lede, at } = lageByTicket();
  const todos = openTodosByTicket();
  const base = process.env.JIRA_URL?.replace(/\/+$/, "") ?? null;
  if (id === "jira-lage") {
    const list: Ticket[] = lageTickets.filter((t) => !t.left).map((t) => ({ ...t }));
    // The columns of your Jira boards, merged (same name: one column, their statuses together) —
    // the first board's order, the others' own columns before its last ("Fertig").
    const merged: JiraColumn[] = [];
    let error: string | undefined;
    for (const b of getDb().select().from(jiraBoards).where(eq(jiraBoards.enabled, true)).all()) {
      const r = await boardColumns(b.id);
      error ??= r.error;
      for (const c of r.columns ?? []) {
        const same = merged.find((m) => m.name.toLowerCase() === c.name.toLowerCase());
        if (same) same.statuses = [...new Set([...same.statuses, ...c.statuses])];
        else if (merged.length) merged.splice(merged.length - 1, 0, { ...c });
        else merged.push({ ...c });
      }
    }
    return {
      id,
      name: "Meine Lage",
      description: "Die Tickets des letzten Lage-Laufs — in den Spalten deiner Jira-Boards.",
      source: "Jira Lage",
      url: null,
      columns: place(list, merged.length ? merged : null, byKey, todos),
      lede,
      lageAt: at,
    boardLage: boardLageState(),
      error: error ?? null,
    };
  }
  const m = /^jira-(\d+)$/.exec(id);
  if (!m) return null;
  const boardId = Number(m[1]);
  const b = getDb().select().from(jiraBoards).where(eq(jiraBoards.id, boardId)).get();
  if (!b) return null;
  const since = Date.now() - RECENT_DONE;
  const people = new Map(lageTickets.map((t) => [t.key.toUpperCase(), t.people ?? []]));
  const list: Ticket[] = getDb()
    .select()
    .from(jiraTickets)
    .where(eq(jiraTickets.boardId, boardId))
    .all()
    .filter((t) => !t.resolvedAt || Date.parse(t.resolvedAt) > since)
    .map((t) => ({ key: t.key, summary: t.summary, status: t.status, statusCategory: t.statusCategory, issueType: t.issueType, priority: t.priority, assignee: t.assignee, url: t.url, updatedAt: t.updatedAt, people: people.get(t.key.toUpperCase()) }));
  const { columns, error } = await boardColumns(boardId);
  return {
    id,
    name: b.name,
    description: `Jira-Board${b.projectKey ? ` · ${b.projectKey}` : ""}${b.type ? ` · ${b.type}` : ""} — die Spalten wie in Jira, jede Karte mit ihrer Lage.`,
    source: "Jira Lage",
    url: base ? `${base}/secure/RapidBoard.jspa?rapidView=${boardId}` : null,
    columns: place(list, columns, byKey, todos),
    lede,
    lageAt: at,
    boardLage: boardLageState(),
    error: error ?? null,
  };
}
