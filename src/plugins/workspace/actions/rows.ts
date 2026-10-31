"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { toggleTask } from "../doc";
import * as store from "../store";
import { run, asUndoable } from "./shared";
import { loadDatabaseAction } from "./databases";

/**
 * One of Zeff's actions from a row (a draft opened, a message sent, something done in Zeff) — no todo needed. `mode`: a Gmail
 * mail sent or saved as a draft through Gmail's API (the reply's own buttons).
 */
export async function rowActionAction(rowId: number, op: Record<string, unknown>, mode?: "send" | "draft") {
  return run(async () => {
    const r = await (await import("@/lib/ops")).runRowOp(Number(rowId), op && typeof op === "object" ? op : {}, mode === "send" || mode === "draft" ? mode : undefined);
    return { href: r.href ?? null, what: r.what ?? null };
  });
}

/** A reply to a row (a mail, a message) drafted by the AI from its conversation. */
export async function draftRowReplyAction(rowId: number) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    return await (await import("../row-actions")).draftRowReply(Number(rowId));
  });
}

/** A row's database as its views load it (its detail page's blocks read the row from it) — null: not a row. */
export async function rowContextAction(rowId: number) {
  return run(async () => {
    const p = store.getPage(Number(rowId));
    if (!p?.dbId) return { data: null };
    const r = await loadDatabaseAction(p.dbId);
    if (!r.ok) throw new Error(r.error);
    return { data: r.data };
  });
}

/** A row's subtasks (rows of its database linked to it), with whether each is done. */
export async function subtasksAction(rowId: number) {
  return run(async () => ({ subtasks: (await import("../subtasks")).subtasksOf(Number(rowId)) }));
}

/** A subtask added to a row (the relation Parent made with the first). */
export async function addSubtaskAction(parentId: number, title: string) {
  return run(async () => ({ id: (await import("../subtasks")).addSubtask(Number(parentId), String(title ?? "").slice(0, 500)) }));
}

/** A subtask made a row of its own again. */
export async function detachSubtaskAction(rowId: number) {
  return run(async () => ((await import("../subtasks")).detachSubtask(Number(rowId)), {}));
}

/** A subtask checked off (done) or open again. */
export async function setSubtaskDoneAction(rowId: number, done: boolean) {
  return run(async () => ((await import("../subtasks")).setSubtaskDone(Number(rowId), !!done), {}));
}

/** A note's checklist item ticked (or not) on its card: its page changes. */
export async function toggleTaskAction(rowId: number, index: number, checked: boolean) {
  return run(() => {
    const p = store.getPage(Number(rowId));
    if (!p) throw new Error(t("This page is gone."));
    store.updatePage(p.id, { content: toggleTask(p.content, Number(index), !!checked) });
    return {};
  });
}

/** A card dragged on the board: placed between its new neighbours (null: the start / the end). */
export async function placeRowAction(rowId: number, after: number | null, before: number | null) {
  return run(() => (store.placeRow(Number(rowId), { after: after === null ? null : Number(after), before: before === null ? null : Number(before) }), {}));
}

/** The recent actions that can be undone as a whole. */
export async function undoEntriesAction() {
  return run(async () => ({ entries: (await import("../undo")).undoEntries() }));
}

/** How many pages an undo would touch, and how many of them were changed again since. */
export async function undoPreviewAction(id: number) {
  return run(async () => (await import("../undo")).undoPreview(Number(id)));
}

/** An action undone: its pages put back as they were, the ones it made in the trash. */
export async function undoAction(id: number) {
  return run(async () => (await import("../undo")).undo(Number(id)));
}

/** One field set for several rows at once - what could not be set (a computed field, a value that does not fit) is told. */
export async function bulkSetAction(rowIds: number[], propId: string, value: unknown) {
  return run(() => asUndoable(t("Bulk edit: {n} rows", { n: rowIds.length }), () => {
    let done = 0;
    const failed: string[] = [];
    for (const id of rowIds.map(Number).slice(0, 500)) {
      try {
        store.setCell(id, String(propId), value);
        done++;
      } catch (e) {
        failed.push(errorMessage(e));
      }
    }
    void Promise.all(rowIds.map((id) => import("../pipeline").then((p) => p.syncAfterEdit(Number(id))).catch(() => undefined)));
    return { done, failed: [...new Set(failed)] };
  }));
}

/** Several rows moved to another database (see store.moveRowsToDatabase). */
export async function moveRowsAction(rowIds: number[], targetId: number) {
  return run(() =>
    asUndoable(t("Moved {n} rows to another database", { n: rowIds.length }), async () => {
      for (const id of rowIds) await (await import("../source-write")).removeFromSource(Number(id)).catch(() => undefined);
      return store.moveRowsToDatabase(rowIds.map(Number).slice(0, 500), Number(targetId));
    }),
  );
}

/** Several rows to the trash at once (a row of a source that can't be deleted there stays - it is told). */
export async function archiveRowsAction(rowIds: number[]) {
  return run(() => asUndoable(t("Moved {n} rows to the trash", { n: rowIds.length }), async () => {
    const gone: number[] = [];
    const kept: string[] = [];
    for (const id of rowIds.map(Number).slice(0, 500)) {
      try {
        await (await import("../source-write")).removeFromSource(id);
        store.archivePage(id);
        gone.push(id);
      } catch (e) {
        kept.push(errorMessage(e));
      }
    }
    return { gone, kept: [...new Set(kept)] };
  }));
}

/** A row closed (locked, under its database in the tree) and the next one made — its ticks unticked, the next day. */
export async function closeRowAction(rowId: number) {
  return run(async () => {
    return { id: (await import("../close-row")).closeRow(Number(rowId)) };
  });
}

/** A closed row open again — the row its close made gone, if nothing was put in it. */
export async function reopenRowAction(rowId: number) {
  return run(async () => {
    return (await import("../close-row")).reopenRow(Number(rowId));
  });
}

export async function duplicateRowAction(rowId: number) {
  return run(() => {
    const r = store.getPage(Number(rowId));
    if (!r?.dbId) throw new Error(t("No such row."));
    return { id: store.duplicatePage(r.id, { dbId: r.dbId }) };
  });
}

/** The databases that receive rows (a landing column set), for "Send to …". */
export async function receivingDatabasesAction() {
  return run(async () => ({ databases: (await import("../links")).receivingDatabases() }));
}

/** A row sent to another database — a linked copy in its landing column (sent once). */
export async function sendRowAction(rowId: number, targetDb: number) {
  return run(async () => {
    const r = (await import("../links")).sendRow(Number(rowId), Number(targetDb));
    const to = store.getPage(Number(targetDb));
    return { row: r.row, existing: r.existing, database: to?.title ?? "" };
  });
}

/** A copy's link taken off: it's a plain row from now on. */
export async function unlinkRowAction(rowId: number) {
  return run(async () => ({ unlinked: (await import("../links")).unlink(Number(rowId)) }));
}

/** A database opened (or closed) to receive rows: the property and the column they land in. */
export async function setReceiveAction(dbId: number, receive: { prop: string; value: string } | null) {
  return run(() => {
    const d = store.getDatabase(Number(dbId));
    if (!d) throw new Error(t("This database is gone."));
    const { receive: _was, ...rest } = d.schema;
    const next = receive ? { ...rest, receive } : rest;
    store.updateSchema(Number(dbId), next);
    if (receive && !store.getDatabase(Number(dbId))!.schema.receive) throw new Error(t("That column doesn't exist — pick a select or status property and one of its columns."));
    return {};
  });
}

/** The agents of a jobs database: taking Ready cards by themselves (off unless you switch it on), how many at once, how many a day, the default instruction. */
export async function setAgentsAction(dbId: number, cfg: { auto: boolean; parallel: number; perDay: number; defaultInstruction: string }) {
  return run(async () => {
    const d = store.getDatabase(Number(dbId));
    if (!d?.schema.jobs) throw new Error(t("This isn't a jobs database."));
    if (cfg.auto && !isInstalled("work")) throw new Error(t("Code is not installed (Menu → Plugins) — without it no worker takes a job."));
    store.updateSchema(Number(dbId), { ...d.schema, agents: { ...(cfg.auto ? { auto: true as const } : {}), parallel: cfg.parallel, perDay: cfg.perDay, defaultInstruction: cfg.defaultInstruction } });
    // Switched on: what is Ready already is taken now (in the background — the page doesn't wait for the workers).
    if (cfg.auto) void (await import("../jobs")).pumpJobs(Number(dbId)).catch(() => undefined);
    return {};
  });
}

/** The custom view the rows of this row's database have (a plugin's — a person's page): its id, or none. Also writes the block into the page when it is missing. */
export async function rowViewAction(rowId: number) {
  return run(async () => {
    const row = store.getPage(Number(rowId));
    const db = row?.dbId ? store.getDatabase(row.dbId) : null;
    const view = (await import("../row-views")).rowViewOf(db?.schema.dataType);
    // What its page's template is drawn of: the row (computed, as its database's views see it), the database's schema, its own template.
    const data = view && row?.dbId ? store.rowsOf(row.dbId) : null;
    const current = data?.rows.find((r) => r.id === Number(rowId)) ?? null;
    return { view: view?.id ?? null, dbId: row?.dbId ?? null, title: db?.page.title ?? "", schema: db?.schema ?? null, row: current };
  });
}

/** "Use the default layout" on a row's page that is (nearly) empty: its view's widgets put in after the view block. */
export async function applyRowLayoutAction(rowId: number) {
  return run(async () => {
    const r = await asUndoable(t("Use the default layout"), async () => ({ done: (await import("../row-views")).applyRowLayout(Number(rowId)) }));
    if (!r.done) throw new Error(t("The page has content of its own already — add the widgets with / instead."));
    return {};
  });
}

/** A database's rows' page as your template (null: back to the plugin's). */
export async function setRowTemplateAction(dbId: number, template: string | null) {
  return run(async () => {
    const db = store.getDatabase(Number(dbId));
    if (!db) throw new Error(t("The database is gone."));
    const { rowTemplate: _was, ...rest } = db.schema;
    store.saveSchema(db.page.id, template?.trim() ? { ...rest, rowTemplate: template } : rest, t("Relation"));
    return {};
  });
}

/** What a copy's original says (its board, its key, its fields) — for the copy's detail view. Null: not a copy. */
export async function linkedSourceAction(rowId: number) {
  return run(async () => ({ source: (await import("../links")).linkedSource(Number(rowId)) }));
}

// ---------------------------------------------------------------------------
// The blocks of an app's layout: a field, a related list, a button
// ---------------------------------------------------------------------------

/** What the blocks of this layout page (or row) can pick: the database's fields and the databases whose rows belong to it. */
export async function layoutChoicesAction(pageId: number) {
  return run(async () => ({ choices: (await import("../app-blocks")).layoutChoices(Number(pageId)) }));
}

/** The rows of `dbId` that point to this row by `prop`. */
export async function relatedRowsAction(rowId: number, dbId: number, prop: string) {
  return run(async () => ({ rows: (await import("../app-blocks")).relatedRows(Number(rowId), Number(dbId), String(prop)) }));
}

/** A new row of `dbId`, pointing to this row. */
export async function addRelatedRowAction(rowId: number, dbId: number, prop: string, title: string) {
  return run(async () => ({ id: (await import("../app-blocks")).addRelatedRow(Number(rowId), Number(dbId), String(prop), String(title)) }));
}

/** A button of a layout pressed on a row. */
export async function rowButtonAction(rowId: number, spec: { action: string; prop?: string; value?: string }) {
  return run(async () => {
    const b = await import("../app-blocks");
    const action = (b.BUTTON_KINDS as readonly string[]).includes(spec?.action) ? (spec.action as (typeof b.BUTTON_KINDS)[number]) : "set";
    return b.runRowButton(Number(rowId), { action, prop: spec?.prop ? String(spec.prop) : undefined, value: spec?.value !== undefined ? String(spec.value) : undefined });
  });
}
