import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { addRow, createPage, getDatabase, getPage, rawRows, setCell, setPageProps, updateSchema } from "./store";
import { getPerson } from "@/plugins/people/store";
import { coerceAnswers, formCells, formErrors, formFields, formProps, formRowsItems, newFormDef, normalizeForm, shownFields, stampNow, tableFormDef, withHiddenDefaults, type Answers, type FormDef } from "./form-spec";
import { newId, newProperty, TITLE, type Property, type PropType } from "./model";
import { keepPartVersion } from "./part-versions";

/**
 * Forms as pages of their own (kind "form"): what one asks is kept in the page's `props.form` (form-spec.ts says what it may be), the
 * database it fills is named there (`dbId`). Filled in — on its page, at /form/<id>, as a database's entry form or as a block in a
 * page — the answers are checked here again (required among the fields that show, the conditions worked out, choices among the
 * options, related rows of the right database) and make a row. Server only.
 */

/** The database a form fills, as the form needs it: what it can ask (the title first). */
export type FormDb = { id: number; title: string; titleName: string; props: Property[] };
/** A form as it is drawn: its page, what it asks, and its database (null: none chosen, or gone). */
export type FormRun = { id: number; title: string; icon: string; def: FormDef; db: FormDb | null; /** Its database's rows, as a rows item shows them (only with one). */ rows?: FormRow[] };
/** A row of the form's database as a rows item shows it (its cells as stored). */
export type FormRow = { id: number; title: string; cells: Record<string, unknown> };
/**
 * What sending a form came to: the row it made (null: none — what is wrong by field (item id), or a form that only changes rows),
 * and how many rows its rows items changed.
 */
export type FormSent = { id: number | null; errors: Record<string, string>; updated: number };
/** The changes a rows item sends: by item id, row id and property id, the new value (only what was changed). */
export type RowChanges = Record<string, Record<string, Record<string, unknown>>>;
/** How many rows a rows item shows at most. */
const ROWS_SHOWN = 200;

function formDb(dbId: number | null): FormDb | null {
  const d = dbId ? getDatabase(dbId) : null;
  if (!d || d.page.archivedAt) return null;
  return { id: d.page.id, title: d.page.title || t("Untitled"), titleName: d.schema.titleName, props: formProps(d.schema) };
}

/** A form page as it is drawn — null: no form page. A form whose database is gone keeps all its fields (restored, it is as it was). */
export function getForm(id: number): FormRun | null {
  const p = getPage(id);
  if (!p || p.kind !== "form") return null;
  const raw = normalizeForm(p.props.form);
  const db = formDb(raw.dbId);
  const def = db ? normalizeForm(raw, db.props) : raw;
  // (A rows item shows the database's rows: they come with the form, in the database's order.)
  const rows = db && formRowsItems(def).length ? rawRows(db.id).slice(0, ROWS_SHOWN).map((r) => ({ id: r.id, title: r.title, cells: r.cells })) : undefined;
  return { id: p.id, title: p.title, icon: p.icon, def, db, ...(rows ? { rows } : {}) };
}

/** The types a field made from the designer can have (a relation needs its other database — that is made in the database). */
export const NEW_FIELD_TYPES: PropType[] = ["text", "markdown", "number", "date", "checkbox", "select", "multi_select", "status", "url", "email", "phone", "person"];

/**
 * A new field made in the form's designer: a property of the database the form fills (its choices for a select), so the form
 * can ask what the database didn't hold yet. Its id — the designer puts it on the form.
 */
export function addFormField(formId: number, name: string, type: PropType, choices: string[] = []): { prop: string; form: FormRun } {
  const form = getForm(formId);
  if (!form?.db) throw new Error(t("Choose the database this form fills first."));
  const label = name.trim().slice(0, 120);
  if (!label) throw new Error(t("Give the field a name."));
  if (!NEW_FIELD_TYPES.includes(type)) throw new Error(t("A form can't make a field of that type."));
  const d = getDatabase(form.db.id)!;
  if (d.schema.properties.some((p) => p.name.trim().toLowerCase() === label.toLowerCase())) throw new Error(t("The database already has a field “{name}”.", { name: label }));
  const p = newProperty(label, type);
  const names = [...new Set(choices.map((c) => c.trim().slice(0, 80)).filter(Boolean))].slice(0, 50);
  if ((type === "select" || type === "multi_select") && names.length) p.options = names.map((n) => ({ id: newId("o"), name: n, color: "gray" }));
  updateSchema(d.page.id, { ...d.schema, properties: [...d.schema.properties, p] });
  return { prop: p.id, form: getForm(formId)! };
}

/** What a form asks, saved (made to fit: form-spec.ts normalizeForm; fields its database can't take are dropped). */
export function saveForm(id: number, raw: unknown): FormRun {
  const p = getPage(id);
  if (!p || p.kind !== "form") throw new Error(t("This form is not there."));
  let def = normalizeForm(raw);
  if (def.dbId) {
    const db = formDb(def.dbId);
    if (!db) throw new Error(t("No such database."));
    def = normalizeForm(def, db.props);
  }
  // What it asked before: a version to go back to — one per few minutes (the designer saves as you type).
  if (p.props.form && JSON.stringify(p.props.form) !== JSON.stringify(def)) keepPartVersion("form", id, p.props.form, { gapMs: 5 * 60_000 });
  setPageProps(id, { ...p.props, form: def });
  return getForm(id)!;
}

/** A new form page (below `parentId`) for a database — asking its title, unless `def` says what else. Returns its id. */
export function createForm(v: { parentId?: number | null; dbId?: number | null; title?: string; def?: FormDef }): number {
  const db = v.dbId ? formDb(v.dbId) : null;
  if (v.dbId && !db) throw new Error(t("No such database."));
  const def = normalizeForm(v.def ?? newFormDef(db?.id ?? null), db?.props);
  return createPage({ kind: "form", parentId: v.parentId ?? null, title: v.title ?? (db ? `${db.title} – ${t("Form")}` : ""), props: { form: def } });
}

/**
 * "Make a form from this table": a form page beside the database asking every column it can (form-spec.ts tableFormDef) — and its
 * entry form, when it had none (one set stays). Returns its id.
 */
export function formFromTable(dbId: number): number {
  const d = getDatabase(dbId);
  const db = formDb(dbId);
  if (!d || !db) throw new Error(t("No such database."));
  const id = createForm({ parentId: d.page.parentId, dbId, def: tableFormDef(dbId, db.props) });
  if (!d.schema.entryForm) updateSchema(dbId, { ...d.schema, entryForm: id });
  return id;
}

/** The forms that fill a database (for its entry form), by title. */
export function formsOfDb(dbId: number): { id: number; title: string }[] {
  return (getSqlite().prepare("select id, title from ws_pages where kind = 'form' and archived_at is null and template = 0 and json_extract(props, '$.form.dbId') = ? order by title, id").all(dbId) as { id: number; title: string }[]).map((r) => ({ id: r.id, title: r.title || t("Untitled") }));
}

/** Every form (to embed one in a page), with the database it fills. */
export function allForms(): { id: number; title: string; dbTitle: string }[] {
  return (getSqlite().prepare("select id, title, json_extract(props, '$.form.dbId') db from ws_pages where kind = 'form' and archived_at is null and template = 0 order by title, id").all() as { id: number; title: string; db: number | null }[]).map((r) => ({ id: r.id, title: r.title || t("Untitled"), dbTitle: formDb(r.db)?.title ?? "" }));
}

/** Answers as they may come from the browser: a plain object, values plain (words, yes/no, numbers, lists of them). */
function cleanAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Answers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (k === "rows" && v && typeof v === "object" && !Array.isArray(v)) continue; // (a rows item's changes: rowChanges)
    if (typeof v === "string") out[k] = v.slice(0, 20000);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string" || typeof x === "number").slice(0, 200);
  }
  return out;
}

/**
 * What a form's rows items change, made to fit: rows of its database only, columns of the item only, each value as its cell takes
 * it; a stamp's checkbox ticked (it wasn't) sets its date to now unless a time was sent. A list of [row, property, value].
 */
function rowChanges(def: FormDef, db: FormDb, raw: unknown): [number, string, unknown][] {
  const items = formRowsItems(def);
  if (!items.length || !raw || typeof raw !== "object") return [];
  const rows = new Map(rawRows(db.id).map((r) => [r.id, r]));
  const out: [number, string, unknown][] = [];
  for (const item of items) {
    const byRow = (raw as RowChanges)[item.id];
    if (!byRow || typeof byRow !== "object") continue;
    for (const [rid, vals] of Object.entries(byRow).slice(0, ROWS_SHOWN)) {
      const row = rows.get(Number(rid));
      if (!row || !vals || typeof vals !== "object") continue;
      const sent = cleanAnswers(Object.fromEntries(Object.entries(vals).filter(([k]) => item.cols.includes(k))));
      const given = coerceAnswers(sent, db.props);
      for (const [k, v] of Object.entries(given)) {
        const p = db.props.find((x) => x.id === k);
        if (!p) continue;
        const value = v === "" ? null : p.type === "number" ? (Number.isFinite(Number(String(v).replace(",", "."))) ? Number(String(v).replace(",", ".")) : null) : v;
        out.push([row.id, k, value]);
      }
      if (item.stamp && given[item.stamp.check] === true && row.cells[item.stamp.check] !== true && !(item.stamp.time in sent)) out.push([row.id, item.stamp.time, stampNow()]);
    }
  }
  return out;
}

/**
 * A form's answers checked and made a row of `db` — or what is wrong. Related rows must be rows of the database the relation points to.
 * `context`: the cells the view the row is made in gives it (a board column's value, a calendar day) — for the columns the form
 * doesn't show (over a hidden field's default); what it shows is answered.
 */
function submitDef(def: FormDef, db: FormDb, raw: unknown, context: Record<string, unknown> = {}): FormSent {
  const changes = rowChanges(def, db, raw && typeof raw === "object" ? (raw as { rows?: unknown }).rows : undefined);
  // A form with no fields of its own only changes rows: no row is made.
  const makes = formFields(def).length > 0;
  const answers = coerceAnswers(cleanAnswers(raw), db.props);
  const errors = formErrors(def, answers, db.props, t);
  for (const f of formFields(def)) {
    const p = db.props.find((x) => x.id === f.prop);
    const v = answers[f.prop];
    if (errors[f.id] || p?.type !== "relation" || !Array.isArray(v) || !v.length) continue;
    const there = new Set(p.relationDb ? rawRows(p.relationDb).map((r) => r.id) : []);
    if (v.some((x) => !there.has(Number(x)))) errors[f.id] = t("Please pick from the list for “{field}”.", { field: f.label || p.name });
  }
  if (Object.keys(errors).length) return { id: null, errors, updated: 0 };
  // The rows changed and the new row made together: all of it, or (a locked row, a protected field) none of it.
  return getSqlite().transaction((): FormSent => {
    for (const [row, prop, value] of changes) setCell(row, prop, value);
    const made = formCells(def, answers, db.props);
    const showing = shownFields(def, withHiddenDefaults(def, answers, db.props), db.props);
    const shown = new Set(formFields(def).filter((f) => showing.has(f.id)).map((f) => f.prop));
    const given = Object.fromEntries(Object.entries(context).filter(([k]) => k !== TITLE && !shown.has(k)));
    const id = makes ? addRow(db.id, { ...made, cells: { ...made.cells, ...given } }) : null;
    return { id, errors: {}, updated: new Set(changes.map((c) => c[0])).size };
  })();
}

/**
 * A form page filled in: the row it makes (the routines on "row added" go on from there), or what is wrong by field. `context`: the
 * cells of the view it was opened from (submitDef).
 */
export function submitForm(formId: number, raw: unknown, context?: Record<string, unknown>): FormSent {
  const p = getPage(formId);
  const form = getForm(formId);
  if (!form || p?.archivedAt) throw new Error(t("This form is not there."));
  if (!form.db) throw new Error(t("This form has no database to fill yet."));
  return submitDef(form.def, form.db, raw, context && typeof context === "object" && !Array.isArray(context) ? context : {});
}

/** Rows a relation field can point to (the database it relates to), by what their title starts with or contains. */
export function relationChoices(dbId: number, propId: string, q: string): { id: number; label: string }[] {
  const p = getDatabase(dbId)?.schema.properties.find((x) => x.id === propId);
  if (!p || p.type !== "relation" || !p.relationDb) return [];
  const w = q.trim().toLowerCase();
  return rawRows(p.relationDb)
    .filter((r) => !w || r.title.toLowerCase().includes(w))
    .sort((a, b) => Number(b.title.toLowerCase().startsWith(w)) - Number(a.title.toLowerCase().startsWith(w)))
    .slice(0, 10)
    .map((r) => ({ id: r.id, label: r.title || t("Untitled") }));
}

/** The names of chosen people or rows of a person or relation field (by id; who is gone has none) — a default's or a prefill's chips. */
export function pickedLabels(dbId: number, propId: string, ids: number[]): Record<number, string> {
  const p = getDatabase(dbId)?.schema.properties.find((x) => x.id === propId);
  const out: Record<number, string> = {};
  for (const id of ids.filter((x) => Number.isInteger(x) && x > 0).slice(0, 50)) {
    const row = p?.type === "relation" ? getPage(id) : null;
    const name = p?.type === "person" ? getPerson(id)?.name : row && row.dbId === p?.relationDb && !row.archivedAt ? row.title || t("Untitled") : undefined;
    if (name) out[id] = name;
  }
  return out;
}

/** The form an address /form/<id> means: a form page. */
export const formAt = (id: number): FormRun | null => getForm(id);
