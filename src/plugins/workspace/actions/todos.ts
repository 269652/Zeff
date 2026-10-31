"use server";

import { t } from "@/lib/i18n/server";
import * as store from "../store";
import { run, asUndoable } from "./shared";

// ---------------------------------------------------------------------------
// To-do lists: in pages (blocks) and as databases
// ---------------------------------------------------------------------------

/** What a picker and a source list need of a to-do list in a page (without its items). */
export type TaskListInfo = { key: string; pageId: number; listId: string; path: string; title: string; engine: boolean; open: number; total: number; database: number | null };

const infoOf = (l: import("../task-lists").TaskList): TaskListInfo => ({ key: l.key, pageId: l.pageId, listId: l.listId, path: l.path, title: l.title, engine: l.engine, open: l.items.filter((i) => !i.checked && i.text).length, total: l.items.filter((i) => i.text).length, database: null });

/** Every to-do list in the pages, by their path. */
export async function taskListsAction() {
  return run(async () => ({ lists: (await import("../task-lists")).allTaskLists().map(infoOf) }));
}

/** One list with its items (for a block that embeds it). */
export async function taskListAction(pageId: number, listId: string) {
  return run(async () => {
    const l = (await import("../task-lists")).getTaskList(Number(pageId), String(listId));
    if (!l) throw new Error(t("That list is gone."));
    return { list: { ...infoOf(l), pageTitle: l.pageTitle, items: l.items } };
  });
}

/** An item of a list ticked, written, added or removed - in its own page, wherever the list is shown. */
export async function taskItemAction(pageId: number, listId: string, op: { kind: "check"; itemId: string; checked: boolean } | { kind: "text"; itemId: string; text: string } | { kind: "due"; itemId: string; due: string | null } | { kind: "add"; text: string; due?: string | null } | { kind: "remove"; itemId: string }) {
  return run(async () => {
    const m = await import("../task-lists");
    const p = Number(pageId);
    let itemId = "";
    if (op.kind === "check") m.setItemChecked(p, listId, op.itemId, !!op.checked);
    else if (op.kind === "text") m.setItemText(p, listId, op.itemId, String(op.text ?? ""));
    else if (op.kind === "due") m.setItemDue(p, listId, op.itemId, op.due ? String(op.due) : null);
    else if (op.kind === "add") itemId = m.addItem(p, listId, String(op.text ?? ""), op.due ?? null);
    else m.removeItem(p, listId, op.itemId);
    // A list that feeds the Todo engine: its todos follow at once.
    m.syncPageLists(p);
    return { itemId };
  });
}

/** A list's title, and whether its open items are todos of the Todo engine too. */
export async function taskListMetaAction(pageId: number, listId: string, v: { title?: string; engine?: boolean }) {
  return run(async () => ((await import("../task-lists")).setListMeta(Number(pageId), listId, v), {}));
}

/** A list turned into a database (its place in the page taken by the database's Todo view). */
export async function convertTaskListAction(pageId: number, listId: string) {
  return run(() => asUndoable(t("To-do list turned into a database"), async () => await (await import("../task-lists")).convertToDatabase(Number(pageId), listId)));
}

/** The setting "Hide titles automatically" of to-do lists (default: on) - read, or set when `set` is given. */
export async function autoHideTitlesAction(set?: boolean) {
  return run(async () => {
    const { getPref, setPref } = await import("@/lib/prefs");
    if (typeof set === "boolean") setPref("workspace.autoHideListTitles", set);
    return { value: getPref<boolean>("workspace.autoHideListTitles", true) };
  });
}

/** A todo database turned into a list in a page (the way back of "Turn into a database"). */
export async function convertTodoDatabaseAction(dbId: number) {
  return run(() => asUndoable(t("Todo database turned into a list"), async () => (await import("../todo-lists")).convertToList(Number(dbId))));
}

/** A database that follows one list (a data source of its own), with the Todo view. */
export async function followTaskListAction(pageId: number, listId: string) {
  return run(async () => {
    const l = (await import("../task-lists")).getTaskList(Number(pageId), listId);
    if (!l) throw new Error(t("That list is gone."));
    const { createExtSourceDatabase } = await import("../derived");
    const dbId = await createExtSourceDatabase("page-tasks", l.title || l.pageTitle, l.key);
    void import("../pipeline").then((p) => p.startPipeline(dbId, { ai: false })).catch(() => undefined);
    return { dbId };
  });
}

/** A new todo list (a database with its Todo view), under a page or at the top. */
export async function createTodoListAction(title: string, parentId?: number) {
  return run(async () => {
    const { createTodoDatabase } = await import("../todo-lists");
    return createTodoDatabase({ title: String(title || "").trim() || t("To-do list"), parentId: parentId ? Number(parentId) : null });
  });
}

/** A todo list's settings: the box that says done, the date that says due, whether its open rows are todos of the Todo engine. */
export async function todoListSettingsAction(dbId: number, v: { done?: string; due?: string; engine?: boolean }) {
  return run(async () => ({ schema: (await import("../todo-engine")).setTodoList(Number(dbId), v) }));
}

/** The rules that make rows by themselves, of a database. */
export async function recurrencesAction(dbId: number) {
  return run(async () => ({ rules: (await import("../recurring")).recurrences(Number(dbId)) }));
}

export async function saveRecurrenceAction(v: import("../recurring").RecurrenceInput) {
  return run(async () => ({ rule: (await import("../recurring")).saveRecurrence(v) }));
}

export async function removeRecurrenceAction(id: string) {
  return run(async () => ((await import("../recurring")).removeRecurrence(String(id)), {}));
}

/** The {{placeholders}} a row template asks for (to be filled in when a row is made from it). */
export async function templateParamsAction(templateId: number) {
  return run(() => ({ params: store.templateParams(Number(templateId)) }));
}

/** A list's day closed by hand (day-log.ts): the day the ticks were made on — its entry locked, the ticks off. Its entry and day. */
export async function closeDayAction(dbId: number) {
  return run(async () => {
    const log = await import("../day-log");
    const day = log.openDay(Number(dbId));
    return { id: log.closeDay(Number(dbId)), day };
  });
}

/** The list's last close undone: the entry open again, the ticks back. */
export async function undoCloseDayAction(dbId: number) {
  return run(async () => {
    (await import("../day-log")).undoCloseDay(Number(dbId));
    return {};
  });
}

/** A day list's today, history and figures (day-lists.ts) — what its tabs show. */
export async function dayListAction(dbId: number) {
  return run(async () => {
    const s = (await import("../day-lists")).dayStats(Number(dbId));
    if (!s) throw new Error(t("Only a daily list has days to close."));
    return { stats: s };
  });
}

/** A new day list (New → Day list): medicines, a routine or habits. Its id. */
export async function createDayListAction(kind: string, parentId?: number | null) {
  return run(async () => {
    const m = await import("../day-lists");
    if (!(m.DAY_LIST_KINDS as readonly string[]).includes(kind)) throw new Error(t("No such kind of day list."));
    return { id: m.createDayList(kind as (typeof m.DAY_LIST_KINDS)[number], parentId ? Number(parentId) : null) };
  });
}

/** A database used as a day list, or no longer. */
export async function setDayListAction(dbId: number, on: boolean) {
  return run(async () => ((await import("../day-lists")).setDayList(Number(dbId), !!on), {}));
}

/** An item of a day list ticked or unticked in place (Today). */
export async function tickDayItemAction(rowId: number, on: boolean) {
  return run(async () => ((await import("../day-lists")).tickDayItem(Number(rowId), !!on), {}));
}
