"use server";

import { t } from "@/lib/i18n/server";
import { asUndoable, readOnlyRows, run } from "./shared";

// ---------------------------------------------------------------------------
// A view's <lookup>: what it finds elsewhere, and the hit picked as a row
// ---------------------------------------------------------------------------

/** The hits for what was typed. */
export async function lookupSearchAction(source: string, query: string, language: string, enter = false) {
  return run(async () => (await import("../lookups")).searchLookup(String(source), String(query), String(language), enter === true));
}

/** The hit picked becomes a row, with the fields of the map. */
export async function lookupAddAction(v: { dbId: number; source: string; hit: string; language: string; map: [string, string][]; unique?: string }) {
  return run(async () => {
    if (await readOnlyRows(Number(v.dbId))) throw new Error(t("This database's rows come from its source."));
    const { addLookupRow } = await import("../lookups");
    return asUndoable(t("Added from {source}", { source: String(v.source) }), () => addLookupRow({ ...v, dbId: Number(v.dbId), source: String(v.source), hit: String(v.hit), language: String(v.language) }));
  });
}
