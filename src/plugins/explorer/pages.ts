/**
 * The Explorer's pages in the Workspace: a page made from the template "Explorer" (or by opening /explorer) shows the Explorer
 * above its text, each remembering the folder it was last in. Kept in a pref of the account. Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { createPage, getPage, updatePage } from "@/plugins/workspace/store";

const PREF = "explorer:pages";
type PageState = { path: string | null; /** Its places (Quick access, watched folders, drives) under the page in the Workspace tree instead of beside the files. */ inTree?: boolean };

const all = (): Record<string, PageState> => getPref<Record<string, PageState>>(PREF, {});

/** Whether a page is one of the Explorer's (and not in the trash). */
export function isExplorerPage(pageId: number): boolean {
  if (!(String(pageId) in all())) return false;
  const p = getPage(pageId);
  return !!p && !p.archivedAt && p.kind === "page";
}

/** The folder an Explorer page was last in (null: This PC). */
export const lastPath = (pageId: number): string | null => all()[String(pageId)]?.path ?? null;

export function rememberPath(pageId: number, path: string | null): void {
  const list = all();
  if (!(String(pageId) in list)) return;
  setPref(PREF, { ...list, [String(pageId)]: { ...list[String(pageId)], path } });
}

/** Whether an Explorer page shows its places in the Workspace tree. */
export const placesInTree = (pageId: number): boolean => !!all()[String(pageId)]?.inTree;

export function setPlacesInTree(pageId: number, on: boolean): void {
  const list = all();
  if (!(String(pageId) in list)) throw new Error(t("This isn't an Explorer page."));
  setPref(PREF, { ...list, [String(pageId)]: { ...list[String(pageId)], inTree: on } });
}

/** The Explorer pages (still there) whose places are in the Workspace tree. */
export const pagesWithPlacesInTree = (): number[] =>
  Object.entries(all())
    .filter(([, v]) => v.inTree)
    .map(([k]) => Number(k))
    .filter(isExplorerPage);

/** A new Explorer page under `parentId` (wide, so the panes fit); its id. */
export function createExplorerPage(parentId: number | null, startAt: string | null = null): number {
  const id = createPage({ parentId, title: t("Explorer"), icon: "🗂️" });
  updatePage(id, { fullWidth: true });
  setPref(PREF, { ...all(), [String(id)]: { path: startAt } });
  return id;
}

/** The Explorer page /explorer opens: the first one still there, else a new one at the top of the Workspace. */
export function explorerPage(): number {
  for (const id of Object.keys(all()).map(Number)) if (isExplorerPage(id)) return id;
  return createExplorerPage(null);
}
