import { getPref, setPref } from "@/lib/prefs";

/**
 * The Workspace's system pages (System, its Prompts, their groups, each prompt): not deleted, not moved away. Their ids,
 * per account — the Workspace's store asks before it archives, deletes or moves a page.
 */

const KEY = "system.pages";

export const systemPageIds = (): number[] => getPref<number[]>(KEY, []);
export const isSystemPage = (id: number): boolean => systemPageIds().includes(id);
export function addSystemPage(id: number): void {
  const ids = systemPageIds();
  if (!ids.includes(id)) setPref(KEY, [...ids, id]);
}
/** Pages that are not system pages any more (a part of the system gone — they can be trashed again). */
export function removeSystemPages(ids: number[]): void {
  const gone = new Set(ids);
  setPref(KEY, systemPageIds().filter((x) => !gone.has(x)));
}
