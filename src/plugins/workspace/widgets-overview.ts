import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { cardScope, parsedTemplate, renderTemplate, starterTemplate, type VNode } from "./card-template";
import { jobsNeedingYou } from "./jobs";
import { filterRows, noLabels, sortRows, type Row } from "./model";
import { sourceTable } from "./source-table";
import { getDatabase, labelsFor, rowsOf } from "./store";
import type { WidgetCard, WidgetData, WidgetItem, WidgetTile, WorkspaceWidget, WidgetSetting } from "./widget-point";

/**
 * Widgets made of what Zeff knows — the same data the rollups and joins use (booked time, merge requests, todos, worker runs, agent jobs):
 * an overview in figures, what needs attention, and any database drawn as cards by its view's card template.
 */

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const round = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 864e5);

/** A source's rows with their cells by property name (empty when the source isn't there — its plugin isn't installed). */
function table(id: string): Record<string, unknown>[] {
  const s = sourceTable(id);
  if (!s) return [];
  const names = new Map(s.schema.properties.map((p) => [p.id, p.name]));
  return s.rows.map((r) => ({ title: r.title, ...Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [names.get(k) ?? k, v])) }));
}
const has = (id: string) => !!sourceTable(id);

const WAITING_DAYS = 3;

function overview(): WidgetData {
  const today = iso(new Date());
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = iso(monday);
  const tiles: WidgetTile[] = [];

  if (has("time")) {
    const rows = table("time");
    const sum = (from: string) => round(rows.filter((r) => String(r.Date ?? "") >= from && String(r.Date ?? "") <= today).reduce((a, r) => a + (Number(r.Hours) || 0), 0));
    tiles.push({ label: t("Hours today"), value: `${sum(today)} h`, detail: t("{n} h this week", { n: sum(weekStart) }) });
  }
  if (has("todos")) {
    const open = table("todos").filter((r) => r.Status === "open");
    const overdue = open.filter((r) => r.Due && String(r.Due) < today).length;
    tiles.push({ label: t("Open todos"), value: String(open.length), detail: overdue ? t("{n} overdue", { n: overdue }) : t("none overdue"), tone: overdue ? "bad" : undefined, href: "/todos" });
  }
  if (has("mrs")) {
    const open = table("mrs").filter((r) => /opened/i.test(String(r.State ?? "")));
    const waiting = open.filter((r) => r.Updated && daysBetween(String(r.Updated), today) >= WAITING_DAYS).length;
    tiles.push({ label: t("Open merge requests"), value: String(open.length), detail: waiting ? t("{n} without movement for {days}+ days", { n: waiting, days: WAITING_DAYS }) : t("all moving"), tone: waiting ? "warn" : undefined });
  }
  if (has("runs")) {
    const runs = table("runs");
    const running = runs.filter((r) => r.Status === "running").length;
    const queued = runs.filter((r) => r.Status === "queued").length;
    tiles.push({ label: t("Workers at work"), value: String(running), detail: queued ? t("{n} waiting in the queue", { n: queued }) : running ? t("busy") : t("idle"), tone: running ? "good" : undefined });
  }
  const jobs = jobsNeedingYou();
  if (jobs.length) {
    const asking = jobs.filter((j) => j.state === "Rückfrage").length;
    tiles.push({ label: t("Agent jobs for you"), value: String(jobs.length), detail: asking ? t("{n} with a question", { n: asking }) : t("to check"), tone: asking ? "warn" : undefined, href: `/workspace/${jobs[0].dbId}` });
  }
  return { kind: "stats", tiles };
}

const URGENCY: Record<string, number> = { question: 0, overdue: 1, failed: 2, "due today": 3, "to check": 4, "MR waiting": 5 };
const ICON: Record<string, string> = { question: "❓", overdue: "⏰", failed: "⚠️", "due today": "📌", "to check": "👀", "MR waiting": "🔀" };

function attention(limit: number): WidgetData {
  const today = iso(new Date());
  const items: (WidgetItem & { rank: number })[] = [];
  const add = (badge: string, tone: "bad" | "warn", item: Omit<WidgetItem, "badge" | "tone">) => items.push({ icon: ICON[badge], ...item, badge: BADGE[badge] ?? badge, tone, rank: URGENCY[badge] ?? 9 });
  const BADGE: Record<string, string> = { question: t("question"), overdue: t("overdue"), failed: t("failed"), "due today": t("due today"), "to check": t("to check"), "MR waiting": t("MR waiting") };

  for (const j of jobsNeedingYou()) {
    add(j.state === "Rückfrage" ? "question" : "to check", j.state === "Rückfrage" ? "warn" : "warn", { id: `job:${j.rowId}`, text: j.title, detail: j.state === "Rückfrage" ? t("An agent asks you something") : t("Agent job to check"), href: `/workspace/${j.dbId}?row=${j.rowId}` });
  }
  for (const r of table("todos").filter((x) => x.Status === "open" && x.Due)) {
    const days = daysBetween(String(r.Due), today);
    const n = /^T-(\d+)$/.exec(String(r.Todo ?? ""))?.[1];
    const base = { id: `todo:${r.Todo}`, text: String(r.title), href: n ? `/todos#todo-${n}` : "/todos" };
    if (days > 0) add("overdue", "bad", { ...base, detail: [r.Todo, r.Ticket, t("{n} days overdue", { n: days })].filter(Boolean).join(" · ") });
    else if (days === 0) add("due today", "warn", { ...base, detail: [r.Todo, r.Ticket].filter(Boolean).join(" · ") });
  }
  for (const r of table("mrs").filter((x) => /opened/i.test(String(x.State ?? "")) && x.Updated)) {
    const days = daysBetween(String(r.Updated), today);
    if (days >= WAITING_DAYS) add("MR waiting", "warn", { id: `mr:${r.MR}:${r.Project}`, text: String(r.title), detail: [r.MR, String(r.Project ?? "").split("/").pop(), t("{n} days without movement", { n: days })].join(" · "), href: String(r.Link ?? "") || undefined });
  }
  const since = Date.now() - 864e5;
  for (const r of table("runs").filter((x) => x.Status === "failed" && x.Started && new Date(`${x.Started}T23:59:59`).getTime() >= since)) {
    add("failed", "bad", { id: `run:${r.Run}`, text: `${r.Run}${r.Ticket ? ` · ${r.Ticket}` : ""}`, detail: t("A worker run failed"), href: "/code" });
  }
  items.sort((a, b) => a.rank - b.rank);
  return { kind: "list", count: items.length || undefined, items: items.slice(0, limit).map(({ rank: _rank, ...i }) => i), empty: t("Nothing needs you right now. ✓"), footer: items.length > limit ? { text: t("{n} more", { n: items.length - limit }), href: "/todos" } : undefined };
}

/** The database a setting names: a page id, or a title (case does not matter). */
function findDatabase(name: string): number | null {
  const s = name.trim();
  if (!s) return null;
  if (/^\d+$/.test(s) && getDatabase(Number(s))) return Number(s);
  const row = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and lower(title) = lower(?) order by id limit 1").get(s) as { id: number } | undefined;
  return row?.id ?? null;
}

async function databaseCards(config: { database: string; view: string; limit: number }): Promise<WidgetData> {
  const id = findDatabase(config.database);
  if (!id) throw new Error(config.database.trim() ? t("There is no database “{name}”.", { name: config.database }) : t("Pick a database in the widget's settings."));
  const d = rowsOf(id)!;
  const view = d.schema.views.find((v) => v.name.toLowerCase() === config.view.trim().toLowerCase()) ?? d.schema.views.find((v) => v.type === "gallery" || v.type === "board") ?? d.schema.views[0];
  let rows: Row[] = view ? filterRows(d.rows, view.filter, d.schema.properties, noLabels) : d.rows;
  rows = view?.sorts.length ? sortRows(rows, view.sorts, d.schema.properties) : rows;
  const total = rows.length;
  rows = rows.slice(0, config.limit);
  const labels = await labelsFor(d.schema, rows);
  const { rowKey } = await import("./collections");
  const tpl = parsedTemplate(view?.card?.trim() ? view.card : starterTemplate(d.schema.properties));
  const cards: WidgetCard[] = rows.map((r) => {
    const scope = cardScope({
      row: r,
      props: d.schema.properties,
      titleName: d.schema.titleName,
      key: rowKey(r),
      labels: { person: (n) => labels.people[n] ?? `#${n}`, page: (n) => labels.pages[n]?.title ?? `#${n}`, todo: (n) => labels.todos[n] ?? `T-${n}` },
    });
    const nodes: VNode[] = tpl.errors.length ? [r.title] : renderTemplate(tpl.nodes, scope).nodes;
    return { id: String(r.id), nodes, href: `/workspace/${id}?row=${r.id}` };
  });
  const title = getDatabase(id)!.page.title;
  return { kind: "cards", cards, empty: t("No rows."), footer: { text: total > cards.length ? t("{title} — {n} more", { title, n: total - cards.length }) : title, href: `/workspace/${id}` } };
}

export const OVERVIEW_WIDGETS: WorkspaceWidget[] = [
  {
    id: "workspace.overview",
    get label() {
      return t("Overview");
    },
    icon: "📊",
    get description() {
      return t("Your day in figures: hours booked, open todos, merge requests, workers and agent jobs — what to look at first.");
    },
    size: "full",
    ttl: 20,
    data: () => overview(),
  },
  {
    id: "workspace.attention",
    get label() {
      return t("Needs attention");
    },
    icon: "🔔",
    get description() {
      return t("What waits for you, the most pressing first: an agent's question, overdue todos, a job to check, a merge request without movement, a failed run.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 }];
    },
    size: "half",
    ttl: 20,
    data: (config) => attention(Number(config.limit)),
  },
  {
    id: "workspace.database",
    get label() {
      return t("Database as cards");
    },
    icon: "🗂️",
    get description() {
      return t("Any database of the Workspace drawn as cards by one of its views — its filter, sort and card template (rollups and joins included).");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "database", label: t("Database (its name or page number)"), kind: "text", default: "" },
        { key: "view", label: t("View (its name; empty: the first board or gallery)"), kind: "text", default: "" },
        { key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 30 },
      ];
    },
    size: "half",
    ttl: 20,
    data: (config) => databaseCards({ database: String(config.database ?? ""), view: String(config.view ?? ""), limit: Number(config.limit) }),
  },
];
