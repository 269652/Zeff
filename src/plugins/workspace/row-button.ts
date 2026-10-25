import { t } from "@/lib/i18n/server";
import { propById } from "./model";
import { getDatabase, getPage } from "./store";

/**
 * A button field pressed (model.ts: a property of type "button"): its routine runs with the row in hand — as a run of its own, undone
 * as one, named in the row's history (the routine's title is the cause). The cell stores nothing. Server only.
 */
export async function pressButton(rowId: number, propId: string): Promise<{ status: string; error?: string }> {
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  const p = db ? propById(db.schema.properties, propId) : undefined;
  if (!row || !p || p.type !== "button") throw new Error(t("There is no such button."));
  if (!p.button?.routine) throw new Error(t("This button has no routine yet — pick one in the field's settings."));
  const { getRoutine } = await import("./routines");
  if (!getRoutine(p.button.routine)) throw new Error(t("The button's routine is gone."));
  const { runRoutine } = await import("./routine-run");
  const r = await runRoutine(p.button.routine, { kind: "manual" }, { row: rowId });
  return { status: r.status, ...(r.error ? { error: r.error } : {}) };
}
