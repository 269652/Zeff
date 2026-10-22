import { getDatabase, saveSchema } from "./store";

/** Hides an entry of an app view's navigation (in the tree), or shows it again. Entries are never deleted. */
export function setNavHidden(dbId: number, viewId: string, entry: string, hidden: boolean): void {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const views = d.schema.views.map((v) => {
    if (v.id !== viewId) return v;
    const rest = (v.navHidden ?? []).filter((x) => x !== entry);
    return { ...v, navHidden: hidden ? [...rest, entry] : rest };
  });
  saveSchema(dbId, { ...d.schema, views }, "Relation");
}

/** Where an app view's navigation is: in the view, or in the Workspace tree. */
/** Where a view's sidebar is: in the Workspace tree, beside the view, or nowhere ("off"). */
export function setNavPlace(dbId: number, viewId: string, place: "view" | "workspace" | "off"): void {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const views = d.schema.views.map((v) => (v.id === viewId ? { ...v, nav: place === "workspace" || place === "off" ? place : undefined } : v));
  saveSchema(dbId, { ...d.schema, views }, "Relation");
}
