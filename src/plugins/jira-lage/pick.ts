/**
 * "Find tickets for me" on a mirrored Jira board — which tickets come into question next for you, and in which order.
 * Pure (client and server): the board's database rows in, the picked tickets out. The board view's toggle and the
 * assistant's tools (mcp.ts: workspace_tickets_for_me, workspace_board_filter) both use it.
 *
 * The rules:
 * - A column's stage comes from its name, else from where it is on the board:
 *   done — named like done/closed/resolved/released/erledigt/fertig/geschlossen …, or the board's last column (to-workspace.ts
 *          puts it in the "done" group);
 *   ready — named like "Ready", "Ready for Dev", "Bereit" (not "Ready for QA/Test/Review/Release …"); no such column:
 *          "Selected for development" / "Sprint backlog"; none of those either: "To Do" / "Open" / "Offen" / "Neu"; still none:
 *          the first column that isn't backlog or done;
 *   backlog — named like backlog/icebox/ideas/refinement/triage/draft, or any column left of the ready ones;
 *   active — everything else (In Progress, In Review, QA …: work started and not done).
 * - Yours: the assignee is you — compared loosely (case, accents, "Last, First", an e-mail's or login's name part).
 * - For you: (1) still open for you — your tickets in an active column, the ones nearest to done first; then (2) ready to
 *   pick up — tickets in a ready column that are unassigned or already yours (yours first), by Jira priority, then by the
 *   board's order (Jira's rank).
 */
import type { DbSchema, Row } from "@/plugins/workspace/model";

export type Stage = "backlog" | "ready" | "active" | "done";
export const STAGES: readonly Stage[] = ["backlog", "ready", "active", "done"];

/** The mirrored board's properties (to-workspace.ts; the key: KEY_PROP of workspace/collections.ts). */
export const JIRA_PROPS = { status: "jirastatus", type: "jiratype", priority: "jirapriority", assignee: "jiraassignee", updated: "jiraupdated", url: "jiraurl", key: "ticketkey" } as const;

export type Column = { name: string; group?: "todo" | "doing" | "done" };
export type Ticket = { id: number; key: string; title: string; status: string; column: number; assignee: string; priority: string; type: string; updated: string; url: string; order: number };

// ---------------------------------------------------------------------------
// Columns: their stage
// ---------------------------------------------------------------------------

const DONE = /\b(done|closed|resolved|complete|completed|released|deployed|cancell?ed|rejected|won'?t\b|erledigt|fertig|geschlossen|abgeschlossen|verworfen|abgelehnt|ausgeliefert)/i;
const BACKLOG = /\b(backlog|icebox|ideas?|ideen|funnel|refinement|triage|draft|entwurf|parked|geparkt|on hold)\b/i;
const NOT_PICKUP = /\b(test|testing|qa|review|release|deploy|abnahme|uat|staging|prod|production|merge|done)\b/i;
const READY_TIERS: RegExp[] = [/\b(ready|bereit)\b/i, /\b(selected for development|sprint backlog|committed|ausgewählt)\b/i, /^\s*(to ?do|open|offen|zu erledigen|new|neu)\s*$/i];

/** Each column's stage (same order as the columns). */
export function columnStages(cols: Column[]): Stage[] {
  const out: (Stage | null)[] = cols.map((c, i) => (DONE.test(c.name) || c.group === "done" || (cols.length > 1 && i === cols.length - 1 && !c.group) ? "done" : null));
  let ready: number[] = [];
  for (const re of READY_TIERS) {
    ready = cols.map((c, i) => (out[i] === null && re.test(c.name) && (re !== READY_TIERS[0] || !NOT_PICKUP.test(c.name.replace(/\b(ready|bereit)\b/i, ""))) ? i : -1)).filter((i) => i >= 0);
    if (ready.length) break;
  }
  if (!ready.length) {
    const first = cols.findIndex((c, i) => out[i] === null && !BACKLOG.test(c.name));
    if (first >= 0) ready = [first];
  }
  for (const i of ready) out[i] = "ready";
  const firstReady = ready.length ? Math.min(...ready) : -1;
  return out.map((s, i) => s ?? (BACKLOG.test(cols[i].name) || i < firstReady ? "backlog" : "active"));
}

// ---------------------------------------------------------------------------
// Who you are
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The ways a name can be written: its words in any order ("Roessler, Moritz"), an e-mail's or login's name part ("moritz.roessler@…"). */
function forms(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];
  const local = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  const words = norm(local).split(" ").filter(Boolean);
  if (!words.length) return [];
  return [...new Set([[...words].sort().join(" "), words.join("")])];
}

/** Whether an assignee is you — `me`: the names Zeff knows you by in Jira (display name, login, e-mail). Loose, never fuzzy. */
export function isMe(assignee: string | null | undefined, me: readonly string[]): boolean {
  const a = forms(String(assignee ?? ""));
  if (!a.length) return false;
  const mine = new Set(me.flatMap(forms));
  if (a.some((f) => mine.has(f))) return true;
  // Only a login known ("mroessler", no display name): first letter + last name of the assignee.
  if (me.some((n) => /\s/.test(n.trim()))) return false;
  const words = norm(String(assignee)).split(" ").filter(Boolean);
  if (words.length < 2) return false;
  const short = [words[0][0] + words[words.length - 1], words[words.length - 1] + words[0][0]];
  return short.some((s) => mine.has(s));
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

const PRIORITIES: [RegExp, number][] = [
  [/blocker|showstopper/i, 0],
  [/sehr niedrig|lowest|trivial/i, 5],
  [/highest|critical|kritisch|urgent|dringend|sehr hoch/i, 1],
  [/low|minor|niedrig|gering/i, 4],
  [/high|major|hoch|wichtig/i, 2],
];
/** A Jira priority's rank: 0 (Blocker) … 5 (Lowest); unknown or none: 3 (Medium). */
export const priorityRank = (name: string | null | undefined): number => PRIORITIES.find(([re]) => re.test(String(name ?? "")))?.[1] ?? 3;

// ---------------------------------------------------------------------------
// The board's rows as tickets
// ---------------------------------------------------------------------------

/** A mirrored board's columns (its status options, in the board's order) and its rows as tickets. */
export function boardTickets(schema: Pick<DbSchema, "properties">, rows: Pick<Row, "id" | "title" | "cells">[]): { columns: Column[]; tickets: Ticket[] } {
  const prop = (id: string) => schema.properties.find((p) => p.id === id);
  const status = prop(JIRA_PROPS.status) ?? schema.properties.find((p) => p.type === "status");
  const options = status?.options ?? [];
  const columns: Column[] = options.map((o) => ({ name: o.name, ...(o.group ? { group: o.group } : {}) }));
  const optName = (id: string, v: unknown) => prop(id)?.options?.find((o) => o.id === v)?.name ?? (typeof v === "string" ? v : "");
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const tickets = rows.map((r, order) => {
    const col = options.findIndex((o) => o.id === r.cells[status?.id ?? ""]);
    return {
      id: r.id,
      key: text(r.cells[JIRA_PROPS.key]),
      title: r.title,
      status: col >= 0 ? options[col].name : "",
      column: col,
      assignee: text(r.cells[JIRA_PROPS.assignee]),
      priority: optName(JIRA_PROPS.priority, r.cells[JIRA_PROPS.priority]),
      type: optName(JIRA_PROPS.type, r.cells[JIRA_PROPS.type]),
      updated: text(r.cells[JIRA_PROPS.updated]),
      url: text(r.cells[JIRA_PROPS.url]),
      order,
    };
  });
  return { columns, tickets };
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export type AssigneeFilter = "me" | "unassigned" | "me_or_unassigned" | "others" | "anyone";
export type PickSort = "priority" | "board" | "updated" | "progress";

/** What to show: "for me" (the preset above), or criteria of the assistant's choosing. Every list is matched loosely (case). */
export type PickCriteria = {
  forMe?: boolean;
  /** Column names (Jira statuses). */
  statuses?: string[];
  stages?: Stage[];
  assignee?: AssigneeFilter;
  priorities?: string[];
  types?: string[];
  /** Words in the key or the summary (all of them). */
  text?: string;
  sort?: PickSort;
  limit?: number;
  /** Exactly these tickets (Jira keys), in this order — the assistant's own choice; the other criteria are then ignored. */
  keys?: string[];
  /** Per key: one line why the assistant picked it. */
  why?: Record<string, string>;
  /** What the assistant calls this view, and why these tickets. */
  title?: string;
  reason?: string;
};

export type PickGroupId = "mine" | "ready" | "match";
export type PickGroup = { id: PickGroupId; tickets: Ticket[]; total: number };
export type PickResult = { groups: PickGroup[]; /** The ready columns' names (empty: the board has none). */ ready: string[]; done: string[] };

const same = (a: string, b: string) => norm(a) === norm(b);

function narrow(list: Ticket[], c: PickCriteria): Ticket[] {
  const words = norm(c.text ?? "").split(" ").filter(Boolean);
  return list.filter(
    (x) =>
      (!c.priorities?.length || c.priorities.some((p) => same(p, x.priority))) &&
      (!c.types?.length || c.types.some((p) => same(p, x.type))) &&
      (!words.length || words.every((w) => norm(`${x.key} ${x.title}`).includes(w))),
  );
}

const byBoard = (a: Ticket, b: Ticket) => a.order - b.order;
const byPriority = (a: Ticket, b: Ticket) => priorityRank(a.priority) - priorityRank(b.priority) || byBoard(a, b);
const sorter = (s: PickSort | undefined): ((a: Ticket, b: Ticket) => number) =>
  s === "board" ? byBoard : s === "updated" ? (a, b) => b.updated.localeCompare(a.updated) || byBoard(a, b) : s === "progress" ? (a, b) => b.column - a.column || byPriority(a, b) : byPriority;

const capped = (id: PickGroupId, list: Ticket[], limit?: number): PickGroup => ({ id, tickets: limit ? list.slice(0, limit) : list, total: list.length });

/** The tickets for these criteria, in groups ("for me": still open for you, then ready to pick up; else one group). `limit`: per group. */
export function pickTickets(columns: Column[], tickets: Ticket[], me: readonly string[], c: PickCriteria = { forMe: true }): PickResult {
  const stages = columnStages(columns);
  const stageOf = (x: Ticket): Stage | null => (x.column >= 0 ? stages[x.column] : null);
  const names = (s: Stage) => columns.filter((_, i) => stages[i] === s).map((x) => x.name);
  const base = { ready: names("ready"), done: names("done") };
  const mineOf = (x: Ticket) => isMe(x.assignee, me);
  if (c.keys?.length) {
    const chosen = c.keys.flatMap((k) => tickets.filter((x) => !!x.key && same(k, x.key)).slice(0, 1));
    return { ...base, groups: [capped("match", chosen, c.limit)] };
  }
  const pool = narrow(tickets, c);
  if (c.forMe) {
    const mine = pool.filter((x) => stageOf(x) === "active" && mineOf(x)).sort(sorter("progress"));
    const ready = pool.filter((x) => stageOf(x) === "ready" && (!x.assignee || mineOf(x))).sort((a, b) => Number(mineOf(b)) - Number(mineOf(a)) || sorter(c.sort)(a, b));
    return { ...base, groups: [capped("mine", mine, c.limit), capped("ready", ready, c.limit)] };
  }
  const wanted = c.statuses?.length ? c.statuses : null;
  const want = (x: Ticket) => {
    const s = stageOf(x);
    if (wanted) return wanted.some((w) => same(w, x.status));
    if (c.stages?.length) return !!s && c.stages.includes(s);
    return s !== "done";
  };
  const who = (x: Ticket) => {
    switch (c.assignee ?? "anyone") {
      case "me":
        return mineOf(x);
      case "unassigned":
        return !x.assignee;
      case "me_or_unassigned":
        return !x.assignee || mineOf(x);
      case "others":
        return !!x.assignee && !mineOf(x);
      default:
        return true;
    }
  };
  const match = pool.filter((x) => want(x) && who(x)).sort(sorter(c.sort));
  return { ...base, groups: [capped("match", match, c.limit)] };
}

/** The picked tickets, in the order shown (groups one after the other). */
export const pickedIds = (p: PickResult): number[] => p.groups.flatMap((g) => g.tickets.map((x) => x.id));

/** Criteria to put in an address (?pick=…) and read back — anything odd in it is left out. */
export function encodePick(c: PickCriteria): string {
  return encodeURIComponent(JSON.stringify(c));
}
export function decodePick(raw: string | null | undefined): PickCriteria | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw.startsWith("%7B") || raw.startsWith("%7b") ? decodeURIComponent(raw) : raw) as Record<string, unknown>;
    return cleanCriteria(o);
  } catch {
    return null;
  }
}

const strs = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, max) : undefined);
const ASSIGNEES: readonly AssigneeFilter[] = ["me", "unassigned", "me_or_unassigned", "others", "anyone"];
const SORTS: readonly PickSort[] = ["priority", "board", "updated", "progress"];

/** Criteria as they may be used: known values only, short texts. */
export function cleanCriteria(o: unknown): PickCriteria | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const c: PickCriteria = {};
  if (r.forMe === true) c.forMe = true;
  const statuses = strs(r.statuses);
  if (statuses?.length) c.statuses = statuses;
  const stages = strs(r.stages)?.filter((s): s is Stage => (STAGES as readonly string[]).includes(s));
  if (stages?.length) c.stages = stages;
  if (ASSIGNEES.includes(r.assignee as AssigneeFilter)) c.assignee = r.assignee as AssigneeFilter;
  const priorities = strs(r.priorities);
  if (priorities?.length) c.priorities = priorities;
  const types = strs(r.types);
  if (types?.length) c.types = types;
  if (typeof r.text === "string" && r.text.trim()) c.text = r.text.trim().slice(0, 100);
  if (SORTS.includes(r.sort as PickSort)) c.sort = r.sort as PickSort;
  if (typeof r.limit === "number" && r.limit >= 1) c.limit = Math.min(100, Math.floor(r.limit));
  const keys = strs(r.keys)?.map((k) => k.slice(0, 40));
  if (keys?.length) c.keys = keys;
  if (c.keys && r.why && typeof r.why === "object") {
    const why = Object.fromEntries(
      Object.entries(r.why as Record<string, unknown>)
        .filter(([k, v]) => typeof v === "string" && v.trim() && c.keys!.some((x) => same(x, k)))
        .slice(0, 20)
        .map(([k, v]) => [k, String(v).trim().slice(0, 240)]),
    );
    if (Object.keys(why).length) c.why = why;
  }
  if (typeof r.title === "string" && r.title.trim()) c.title = r.title.trim().slice(0, 80);
  if (typeof r.reason === "string" && r.reason.trim()) c.reason = r.reason.trim().slice(0, 300);
  return c;
}
