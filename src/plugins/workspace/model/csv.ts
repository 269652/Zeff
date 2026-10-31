import type { DbSchema, Row, View } from "./schema";
import { type Labels, noLabels, cellText } from "./values";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const csvCell = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A database as CSV (title first, then the properties in the view's order, hidden ones left out). */
export function rowsToCsv(schema: DbSchema, rows: Row[], view?: View, labels: Labels = noLabels): string {
  const hidden = new Set(view?.hidden ?? []);
  const order = view?.order ?? [];
  const props = [...schema.properties].filter((p) => !hidden.has(p.id)).sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
  const lines = [[schema.titleName, ...props.map((p) => p.name)].map(csvCell).join(";")];
  for (const r of rows) lines.push([r.title, ...props.map((p) => cellText(p, r.cells[p.id], labels))].map(csvCell).join(";"));
  return `${lines.join("\n")}\n`;
}
