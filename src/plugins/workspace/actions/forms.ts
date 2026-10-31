"use server";

import { t } from "@/lib/i18n/server";
import * as store from "../store";
import { run } from "./shared";

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** A form page as it is drawn (what it asks, its database's fields). */
export async function formAction(id: number) {
  return run(async () => {
    const form = (await import("../forms")).getForm(Number(id));
    if (!form) throw new Error(t("This form is not there."));
    return { form };
  });
}

/** What a form asks, saved (the designer's autosave) — the form as it is now kept. */
export async function saveFormAction(id: number, def: unknown) {
  return run(async () => ({ form: (await import("../forms")).saveForm(Number(id), def) }));
}

/** A new field of the database a form fills, made from its designer (its choices for a select). */
export async function addFormFieldAction(formId: number, name: string, type: string, choices: string[] = []) {
  return run(async () => (await import("../forms")).addFormField(Number(formId), String(name ?? ""), type as import("../model").PropType, Array.isArray(choices) ? choices.map(String) : []));
}

/** A new form page for a database (below `parentId`). */
export async function createFormAction(v: { parentId?: number | null; dbId?: number | null; title?: string }) {
  return run(async () => ({ id: (await import("../forms")).createForm({ parentId: v.parentId ?? null, dbId: v.dbId ? Number(v.dbId) : null, title: v.title }) }));
}

/**
 * A form filled in: the row it made — or, by field (item id), what is wrong (nothing made then). `context`: the cells of the view
 * it was opened from (a board column's value, a calendar day) for what the form doesn't ask.
 */
export async function submitFormAction(formId: number, answers: Record<string, unknown>, context?: Record<string, unknown>) {
  return run(async () => (await import("../forms")).submitForm(Number(formId), answers, context));
}

/** "Make a form from this table": a form asking every column, beside the database (its entry form when it had none). */
export async function formFromTableAction(dbId: number) {
  return run(async () => ({ id: (await import("../forms")).formFromTable(Number(dbId)) }));
}

/** The names of chosen people or rows of a field (a default's or a prefill's chips). */
export async function pickedLabelsAction(dbId: number, propId: string, ids: number[]) {
  return run(async () => ({ labels: (await import("../forms")).pickedLabels(Number(dbId), String(propId), Array.isArray(ids) ? ids.map(Number) : []) }));
}

/** The forms there are (to embed one), or those that fill one database (its entry form). */
export async function formsAction(dbId?: number) {
  return run(async () => {
    const f = await import("../forms");
    return { forms: dbId ? f.formsOfDb(Number(dbId)).map((x) => ({ ...x, dbTitle: "" })) : f.allForms() };
  });
}

/** A database's entry form: "New" opens it instead of making an empty row (null: back to an empty row). */
export async function setEntryFormAction(dbId: number, formId: number | null) {
  return run(async () => {
    const d = store.getDatabase(Number(dbId));
    if (!d) throw new Error(t("No such database."));
    const form = formId ? (await import("../forms")).getForm(Number(formId)) : null;
    if (formId && form?.def.dbId !== d.page.id) throw new Error(t("That form doesn't fill this database."));
    const { entryForm: _was, ...rest } = d.schema;
    store.updateSchema(d.page.id, form ? { ...rest, entryForm: form.id } : rest);
    return {};
  });
}

/** A new form for a database, set as its entry form at once (beside the database in the tree): its id, to open it. */
export async function createEntryFormAction(dbId: number) {
  return run(async () => {
    const d = store.getDatabase(Number(dbId));
    if (!d) throw new Error(t("No such database."));
    const id = (await import("../forms")).createForm({ parentId: d.page.parentId, dbId: d.page.id });
    store.updateSchema(d.page.id, { ...d.schema, entryForm: id });
    return { id };
  });
}

/** Rows a relation field of a form can point to (of the database the relation goes to), by their title. */
export async function formRelationChoicesAction(dbId: number, propId: string, q: string) {
  return run(async () => ({ items: (await import("../forms")).relationChoices(Number(dbId), String(propId), String(q ?? "")) }));
}
