import { columnUnit, sheetColumns, TITLE } from "./model";
import * as store from "./store";
import { formulaFunctions, listMetrics } from "./metrics";

/**
 * What the formulas of a page's tables need from the server: the Kennzahlen (values and units, by key), the tables shared for
 * formulas (by name, lower case) and the plugins' functions. One place for the Workspace's formula action and the Notebook's access
 * to a page's calculations. Server only.
 */
export function formulaData() {
  const metrics: Record<string, number | null> = {};
  const metricUnits: Record<string, string> = {};
  for (const m of listMetrics()) {
    metrics[m.key] = m.value;
    if (m.unit) metricUnits[m.key] = m.unit;
  }
  const sheets: Record<string, { cols: string[]; rows: unknown[][]; units: (string | null)[] }> = {};
  for (const s of store.sharedTables()) {
    const d = store.rowsOf(s.id);
    if (!d) continue;
    const ids = sheetColumns(d.schema);
    const prop = (id: string) => d.schema.properties.find((p) => p.id === id);
    sheets[s.name.toLowerCase()] = {
      cols: ids.map((id) => (id === TITLE ? d.schema.titleName : (prop(id)?.name ?? ""))),
      rows: d.rows.slice(0, 2000).map((r) => ids.map((id) => (id === TITLE ? r.title : (r.cells[id] ?? null)))),
      units: ids.map((id) => columnUnit(prop(id))),
    };
  }
  // The plugins' functions (Schulden, Personen …): their names and units — a page's table asks the server for their values.
  const functions = formulaFunctions().map((f) => ({ name: f.name, aliases: f.aliases ?? [], unit: f.unit ?? "", signature: f.signature, what: f.what }));
  return { metrics, metricUnits, sheets, functions };
}
