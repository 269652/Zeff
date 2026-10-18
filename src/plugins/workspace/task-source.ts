import { createHash } from "node:crypto";
import { t } from "@/lib/i18n/server";
import type { Row } from "./model";
import type { WorkspaceSource } from "./source-point";
import { allTaskLists, setItemChecked, type TaskList } from "./task-lists";

/**
 * The to-do lists of the pages as a data source: one record per item, "Done" a two-way box (ticking it in a database writes the tick back
 * into the list in its page), "List" the path of the list ("Workspace / Debt advice / ~1"). A database may follow every list or one (the
 * step's `label` is the list's key "page:list"). Server only.
 */

const REF = /^ptask:(\d+):([\w-]+):([\w-]+)$/;
const F = { done: "taskdone", list: "tasklist" };

const stamp = (checked: boolean, text: string) => createHash("sha1").update(JSON.stringify([checked, text])).digest("hex").slice(0, 12);
const refOf = (l: TaskList, itemId: string) => `ptask:${l.pageId}:${l.listId}:${itemId}`;

export function taskRecords(onlyKey?: string) {
  return allTaskLists()
    .filter((l) => !onlyKey || l.key === onlyKey)
    .flatMap((l) =>
      l.items
        .filter((i) => i.itemId && i.text)
        .map((i) => ({
          ref: refOf(l, i.itemId),
          title: i.text,
          fields: {} as Record<string, string>,
          url: `/workspace/${l.pageId}`,
          updatedAt: stamp(i.checked, i.text),
          typed: [
            { id: F.done, name: "Done", type: "checkbox" as const, value: i.checked },
            { id: F.list, name: "List", type: "text" as const, value: l.path },
            { id: "taskdue", name: "Due", type: "date" as const, value: i.due },
          ],
        })),
    );
}

/** The box "Done" changed in a row: the item in its page follows (when the item was not changed there since). */
export function pullTasks(_dbId: number, rows: Row[]): void {
  const lists = new Map(allTaskLists().map((l) => [l.key, l]));
  for (const row of rows) {
    const m = REF.exec(String(row.cells.srcref ?? ""));
    if (!m) continue;
    const item = lists.get(`${m[1]}:${m[2]}`)?.items.find((i) => i.itemId === m[3]);
    if (!item || String(row.cells.srcedited ?? "") !== stamp(item.checked, item.text)) continue;
    const done = row.cells[F.done] === true;
    if (done !== item.checked) setItemChecked(Number(m[1]), m[2], m[3], done);
  }
}

export const TASKS_SOURCE: WorkspaceSource = {
  id: "page-tasks",
  get label() {
    return t("To-do lists in pages");
  },
  icon: "☑",
  noNewRows: true,
  get hint() {
    return t("Every item of the to-do lists in your pages, with the list it is in. The box “Done” ticks the item in its page.");
  },
  count: () => allTaskLists().reduce((n, l) => n + l.items.filter((i) => i.text).length, 0),
  read: (ctx) => taskRecords(ctx?.label),
  pull: pullTasks,
};
