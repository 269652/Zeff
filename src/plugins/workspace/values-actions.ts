"use server";

import { errorMessage } from "@/lib/errors";
import type { CalcFn } from "./values";

/** What a table's sum row calls: the values published from this database and the names to pick from; publish one, take it back. */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type PublishedHere = { key: string; label: string; viewId: string; propId: string; fn: CalcFn };

/** The values published from this database (to mark their columns) and the names offered. */
export async function valuesOfDbAction(dbId: number): Promise<Result<{ here: PublishedHere[]; names: { key: string; label: string; what: string; taken: boolean }[] }>> {
  return run(async () => {
    const v = await import("./values");
    const here = v
      .listNamedValues()
      .filter((x) => x.dbId === Number(dbId))
      .map((x) => ({ key: x.key, label: x.label, viewId: x.viewId, propId: x.propId, fn: x.fn }));
    return { here, names: v.valueNameSuggestions() };
  });
}

/** A column's calculation published under a name — read anywhere in Zeff from now on. */
export async function publishValueAction(v: { label: string; dbId: number; viewId: string; propId: string; fn: CalcFn }): Promise<Result<{ key: string }>> {
  return run(async () => ({ key: (await import("./values")).publishValue({ label: String(v.label ?? ""), dbId: Number(v.dbId), viewId: String(v.viewId), propId: String(v.propId), fn: v.fn }) }));
}

export async function unpublishValueAction(key: string): Promise<Result> {
  return run(async () => {
    (await import("./values")).unpublishValue(String(key));
    return {};
  });
}
