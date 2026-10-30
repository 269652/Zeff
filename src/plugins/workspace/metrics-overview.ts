import { jobsNeedingYou } from "./jobs";
import type { MetricProvider } from "./metric-point";
import { hasSource, sourceTable } from "./source-table";

/**
 * The Overview widget's numbers as Kennzahlen (metric-point.ts): the merge requests, the workers, the agent jobs — read from
 * the sources the rollups and joins use (each only when its plugin is installed). Server only.
 */

/** A source's rows with their cells by property name (empty when the source isn't there — its plugin isn't installed). */
export function sourceRows(id: string): Record<string, unknown>[] {
  const s = sourceTable(id);
  if (!s) return [];
  const names = new Map(s.schema.properties.map((p) => [p.id, p.name]));
  return s.rows.map((r) => ({ title: r.title, ...Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [names.get(k) ?? k, v])) }));
}

/** A merge request without movement this many days waits. */
export const WAITING_DAYS = 3;

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
export const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 864e5);

const openMrs = () => sourceRows("mrs").filter((r) => /opened/i.test(String(r.State ?? "")));
const runs = (status: string) => sourceRows("runs").filter((r) => r.Status === status).length;
const jobsHref = () => {
  const j = jobsNeedingYou()[0];
  return j ? `/workspace/${j.dbId}` : undefined;
};

export const OVERVIEW_METRICS: MetricProvider[] = [
  { label: "Offene Merge Requests", unit: "", what: "Merge requests still open", read: () => openMrs().length, available: () => hasSource("mrs") },
  {
    label: "Wartende Merge Requests",
    unit: "",
    what: "Open merge requests without movement for 3 days or more",
    read: () => {
      const today = iso(new Date());
      return openMrs().filter((r) => r.Updated && daysBetween(String(r.Updated), today) >= WAITING_DAYS).length;
    },
    available: () => hasSource("mrs"),
    tone: (v) => (v > 0 ? "warn" : undefined),
  },
  { label: "Worker aktiv", unit: "", what: "Worker runs at work right now", read: () => runs("running"), available: () => hasSource("runs"), href: () => "/code", tone: (v) => (v > 0 ? "good" : undefined) },
  { label: "Worker in Warteschlange", unit: "", what: "Worker runs waiting in the queue", read: () => runs("queued"), available: () => hasSource("runs"), href: () => "/code" },
  { label: "Agent-Jobs für dich", unit: "", what: "Agent jobs waiting for you: a question or a result to check", read: () => jobsNeedingYou().length, href: jobsHref },
  {
    label: "Agent-Rückfragen",
    unit: "",
    what: "Agent jobs with a question for you",
    read: () => jobsNeedingYou().filter((j) => j.state === "Rückfrage").length,
    href: jobsHref,
    tone: (v) => (v > 0 ? "warn" : undefined),
  },
];
