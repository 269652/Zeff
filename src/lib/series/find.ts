import type { SeriesInfo } from "./series-point";

/** Finding a series by name. Pure: the Correlations port's lambdas bundle it (scripts/port-correlations.mts). */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A series by what a person or an agent calls it: its id ("db:12:p3", "calendar:meeting-hours"), its whole label ("Journal ›
 * Energy"), or the database's name and the field's ("Journal" + "Energy"; a tag as "Tags: Family"). Any case. Null: none.
 */
export function findSeries<S extends SeriesInfo>(all: S[], q: { database?: string; field: string }): S | null {
  const field = norm(q.field);
  const byId = all.find((s) => s.id === q.field.trim());
  if (byId) return byId;
  if (q.database) {
    const db = norm(q.database);
    return all.find((s) => norm(s.label) === `${db} › ${field}`) ?? all.find((s) => norm(s.group) === db && norm(s.label).endsWith(`› ${field}`)) ?? null;
  }
  return all.find((s) => norm(s.label) === field) ?? all.find((s) => norm(s.label).endsWith(`› ${field}`)) ?? null;
}
