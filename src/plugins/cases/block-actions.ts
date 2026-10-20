"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { caseBundle, caseOp, type CaseBundle, type CaseOperation } from "./blocks";

/** What a case's page calls: its bundle, an operation. None throws at the page. */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    if (!isInstalled("cases")) throw new Error(t("The Cases plugin is not installed (Menu → Plugins)."));
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

const caseId = async (rowId: number): Promise<number> => {
  const id = await (await import("./database")).caseOfRow(Number(rowId));
  if (!id) throw new Error(t("This row is not a case."));
  return id;
};

/** Everything the case's page shows. */
export async function caseBundleAction(rowId: number): Promise<Result<{ case: CaseBundle }>> {
  return run(async () => ({ case: await caseBundle(await caseId(rowId)) }));
}

/** An operation on the case; the cases database reads the cases again after it (its rows follow). */
export async function caseOpAction(rowId: number, op: CaseOperation): Promise<Result<{ message?: string }>> {
  return run(async () => {
    const r = await caseOp(await caseId(rowId), op);
    const db = await (await import("./database")).casesDatabase();
    if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    return r;
  });
}
