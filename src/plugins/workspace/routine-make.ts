import type { DocNode } from "./doc";
import { createRoutine, getRoutine, type RoutineKind } from "./routines";
import { getPage, updatePage } from "./store";

/**
 * A page made an agent or an automation: its routine (off, started by hand) and the controls block at the top — the page's own text
 * stays below as the instructions. A page that is a routine already keeps its kind and only gets the block if it lacks it.
 */
export function makeRoutinePage(pageId: number, kind: RoutineKind): void {
  const p = getPage(pageId);
  if (!p) throw new Error("There is no such page.");
  if (p.kind === "database") throw new Error("A database can't be a routine — make a page in it.");
  if (!getRoutine(pageId)) createRoutine(pageId, kind);
  const doc = (p.content as DocNode | null) ?? { type: "doc", content: [] };
  const has = (doc.content ?? []).some((n) => n.type === "zeffRoutine");
  if (!has) updatePage(pageId, { content: { ...doc, type: "doc", content: [{ type: "zeffRoutine" }, ...(doc.content ?? [])] } });
}
