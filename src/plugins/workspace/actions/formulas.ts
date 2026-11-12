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
  return run(async () => (await import("../formula-data")).formulaData());
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
