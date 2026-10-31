"use server";

import * as store from "../store";
import { run } from "./shared";

/** What a cell's formula can name: the Kennzahlen (@Sparrate) and the tables shared for formulas (Kosten!B2). */
export async function formulaNamesAction() {
  return run(async () => ({
    metrics: (await import("../metrics")).listMetrics().map((m) => m.label),
    tables: store.sharedTables().map((x) => ({ name: x.name, title: x.title })),
    functions: (await import("../metrics")).formulaFunctions().map((f) => ({ name: f.name, signature: f.signature, what: f.what, unit: f.unit ?? "" })),
  }));
}

/** What a page's tables (/Tabelle) need from the server for their formulas: the Kennzahlen' values (by key) and the shared tables' cells (by name). */
export async function formulaDataAction() {
  return run(async () => {
    const { formulaFunctions, listMetrics } = await import("../metrics");
    const { columnUnit, sheetColumns, TITLE } = await import("../model");
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
  });
}

/** A page's table's calls of the plugins' functions (Schulden(@Chris) …), worked out here: each by its key, its value or why not. */
export async function formulaCallsAction(calls: { name: string; args: import("../formula").WireValue[] }[]) {
  return run(async () => {
    const { callKey, fromWire, toWire } = await import("../formula");
    const { formulaFunctions } = await import("../metrics");
    const fns = formulaFunctions();
    const results: Record<string, { value: import("../formula").WireValue } | { error: string }> = {};
    for (const c of calls.slice(0, 200)) {
      const args = (c.args ?? []).map(fromWire);
      const key = callKey(c.name, args);
      const n = String(c.name).toLowerCase();
      const f = fns.find((x) => x.name.toLowerCase() === n || (x.aliases ?? []).some((a) => a.toLowerCase() === n));
      try {
        if (!f) throw new Error(`Unknown function "${c.name}"`);
        results[key] = { value: toWire(f.call(args)) };
      } catch (e) {
        results[key] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { results };
  });
}
