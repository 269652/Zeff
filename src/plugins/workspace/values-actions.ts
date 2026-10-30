"use server";

import type { CalcFn } from "./model";
import { run, type Result } from "@/lib/action-result";

/** What a table's sum row calls: the value types this database's columns are sources of, the names to pick from; add, set, remove. */


/** A column of this database that is a source of a type — with the type's aggregate, its value now and how many sources it has. */
export type PublishedHere = { key: string; label: string; viewId: string; propId: string; agg: CalcFn; value: number | null; sources: number };

/** The types this database's columns are sources of (to mark them), and the names offered. */
export async function valuesOfDbAction(dbId: number): Promise<Result<{ here: PublishedHere[]; names: { key: string; label: string; what: string; taken: boolean }[] }>> {
  return run(async () => {
    const v = await import("./values");
    const here = v.listNamedValues().flatMap((x) =>
      x.sources.filter((s) => s.dbId === Number(dbId)).map((s) => ({ key: x.key, label: x.label, viewId: s.viewId, propId: s.propId, agg: x.agg, value: x.value, sources: x.sources.length })),
    );
    return { here, names: v.valueNameSuggestions() };
  });
}

/** A column made a source of a type ("Fixkosten") — beside its other sources; read anywhere in Zeff. */
export async function publishValueAction(v: { label: string; dbId: number; viewId: string; propId: string; fn?: CalcFn }): Promise<Result<{ key: string }>> {
  return run(async () => ({ key: (await import("./values")).publishValue({ label: String(v.label ?? ""), dbId: Number(v.dbId), viewId: String(v.viewId), propId: String(v.propId), ...(v.fn ? { fn: v.fn } : {}) }) }));
}

/** The column no longer a source of the type. */
export async function removeValueSourceAction(key: string, ref: { dbId: number; viewId: string; propId: string }): Promise<Result> {
  return run(async () => {
    (await import("./values")).removeValueSource(String(key), { dbId: Number(ref.dbId), viewId: String(ref.viewId), propId: String(ref.propId) });
    return {};
  });
}

/** The type's aggregate (sum, average, max …). */
export async function setValueAggregateAction(key: string, fn: CalcFn): Promise<Result> {
  return run(async () => {
    (await import("./values")).setValueAggregate(String(key), fn);
    return {};
  });
}
