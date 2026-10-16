import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { addSystemPage } from "@/lib/prompts/system-pages";
import { detailModules, type DetailModule } from "./model";
import type { DocNode } from "./doc";
import { createPage, getDatabase, getPage, updateSchema } from "./store";
import { listCollections } from "@/lib/items";

/**
 * A database's detail view as a page of blocks — under System → Detail views, its name: the row's properties, subtasks,
 * suggested actions, todos, briefing …, its own page, and any text between — edited like any page (slash menu, dragging).
 * A row's panel shows it, for the row. Made once, from what the database's panel showed so far; it stays (a system page).
 */

const FOLDER = "system.detailFolder";

function folder(): number {
  const known = getPref<number | null>(FOLDER, null);
  if (known && getPage(known) && !getPage(known)!.archivedAt) return known;
  let root = getPref<number | null>("system.root", null);
  if (!root || !getPage(root) || getPage(root)!.archivedAt) {
    root = createPage({ title: t("System"), icon: "🛠" });
    setPref("system.root", root);
    addSystemPage(root);
  }
  const id = createPage({ title: t("Detail views"), icon: "▤", parentId: root });
  setPref(FOLDER, id);
  addSystemPage(id);
  return id;
}

/** The blocks a detail view starts with: the modules it showed (its own page last, as before). */
const blocks = (modules: DetailModule[]): DocNode[] => modules.map((module) => ({ type: "zeffModule", attrs: { module, key: "" } }));

const mod = (module: string): DocNode => ({ type: "zeffModule", attrs: { module, key: "" } });
const flex = (dir: "row" | "col", content: DocNode[], span?: number): DocNode => ({ type: "flexBox", attrs: { dir, gap: "md", ...(span ? { span } : {}) }, content });

/** A person's page as flex boxes: three columns — who they are; what is known; what you have with them — their own page below. */
export const peopleLayout = (): DocNode[] => [
  flex("row", [
    flex("col", [mod("person-profile"), mod("person-note"), mod("person-dates"), mod("person-manage")]),
    flex("col", [mod("person-summary"), mod("person-knowledge"), mod("person-wiki"), mod("person-relations")], 2),
    flex("col", [mod("person-todos"), mod("person-tickets"), mod("person-pages"), mod("person-messages")]),
  ]),
  mod("page"),
];

/** The database's detail page — made (from what it showed) when it has none. Its id. */
export function ensureDetailPage(dbId: number): number {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const known = d.schema.detailPage;
  if (known && getPage(known) && !getPage(known)!.archivedAt) return known;
  const source = listCollections({ plugin: "workspace" }).find((c) => c.id === `workspace:${dbId}`)?.source ?? null;
  const id = createPage({ title: d.page.title || "Untitled", icon: d.page.icon || "▤", parentId: folder(), content: { type: "doc", content: d.schema.dataType === "people" ? peopleLayout() : blocks(detailModules(d.schema, source)) } });
  addSystemPage(id);
  updateSchema(dbId, { ...getDatabase(dbId)!.schema, detailPage: id });
  return id;
}
