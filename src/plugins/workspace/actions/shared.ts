import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { listCollections } from "@/lib/items";
import * as store from "../store";
import "../metrics"; // (kennzahl() in the databases' formulas reads the Kennzahlen)
import { pluginAction, type Result as ActionResult } from "@/lib/action-result";

/** What the Workspace plugin's server actions (actions/*.ts) share: the guard, the runner, and the helpers more than one of them uses. */

export type Result<T = unknown> = ActionResult<T>;

export function guard(): void {
  if (!isInstalled("workspace")) throw new Error(t("The Workspace plugin is not installed (Menu → Plugins)."));
}
export const run = pluginAction("workspace", () => t("The Workspace plugin is not installed (Menu → Plugins)."));

/** A database whose source only lends its records (a row made by hand would have nothing to belong to). */
export async function readOnlyRows(dbId: number): Promise<boolean> {
  const step = store.getDatabase(dbId)?.schema.pipeline?.steps.find((s) => s.kind === "source" && s.from === "ext");
  if (!step?.ext) return false;
  return (await (await import("../source-point")).extSources()).find((s) => s.id === step.ext)?.noNewRows === true;
}

/** You, as rows name people: your name (as Jira knows you) and the people of the People plugin with it. For "mine". */
export async function whoAmI(): Promise<{ names: string[]; ids: number[] }> {
  const { myJiraName } = await import("@/lib/jira/store");
  const names = [myJiraName()].filter((n): n is string => !!n?.trim());
  if (!names.length || !isInstalled("people")) return { names, ids: [] };
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()));
  const { listPeople } = await import("@/plugins/people/store");
  const ids = listPeople()
    .filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => wanted.has(n.trim().toLowerCase())))
    .map((p) => p.id);
  return { names, ids };
}

/** The sync that keeps a database (jira …), or null: its own. */
export const collectionSource = (dbId: number): string | null => listCollections({ plugin: "workspace" }).find((x) => x.id === `workspace:${dbId}`)?.source ?? null;

/** Whether a database is in the briefing and in the knowledge (its collection's switches). */
export function collectionSwitches(dbId: number): { briefing: boolean; knowledge: boolean; sensitivity: "open" | "personal" | "secret" } {
  const c = listCollections({ plugin: "workspace" }).find((x) => x.id === `workspace:${dbId}`);
  return { briefing: !!c?.briefing, knowledge: !!c?.knowledge, sensitivity: c?.sensitivity ?? "open" };
}

/** An action done as one that can be undone: its result, and the id of its entry in the history (null: it changed nothing, or was too big to keep). */
export async function asUndoable<T extends object>(label: string, fn: () => Promise<T> | T, actor: "you" | "ai" | "source" = "you"): Promise<T & { undoId: number | null }> {
  const { undoable } = await import("../undo");
  const { value, undoId } = await undoable(label, fn, actor);
  return { ...value, undoId };
}
