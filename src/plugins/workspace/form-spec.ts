/**
 * Forms (the Workspace plugin): what a form page asks — its steps, and in each its fields, headings, texts and dividers — and the
 * rules over the answers that the designer, the form being filled in and the server all go by: which fields show (a condition on
 * another field), what is missing or doesn't fit, and the defaults of the fields that are not asked. Pure functions; client-safe.
 * Kept in the form page's `props.form` (forms.ts reads and writes it).
 */
import type { T } from "@/lib/i18n/shared";
import { isComputed, newId, SYSTEM_PROPS, TITLE, type Property, type PropType } from "./model";

/** The kinds of property a form can ask (the others are computed, or hold what only Zeff writes). */
export const FORM_FIELD_TYPES: PropType[] = ["text", "markdown", "number", "date", "checkbox", "select", "status", "multi_select", "url", "email", "phone", "person", "relation"];
export const COND_OPS = ["eq", "neq", "contains", "filled", "empty"] as const;
export type CondOp = (typeof COND_OPS)[number];
/** "Show only if": the field asking `prop` is (not) `value`, contains it, is filled or empty. */
export type FormCond = { prop: string; op: CondOp; value?: string };

/**
 * A field of the form: asks the property `prop` (TITLE: the row's title). `hidden`: not asked, its `default` set on every row (a
 * status "New"); else `default` is what it starts with. `width` "half": two sit side by side. `when`: shown only if that holds.
 */
export type FieldItem = { id: string; kind: "field"; prop: string; label?: string; help?: string; placeholder?: string; required?: true; hidden?: true; default?: string; width: "full" | "half"; when?: FormCond };
export type HeadingItem = { id: string; kind: "heading"; text: string };
export type TextItem = { id: string; kind: "text"; text: string };
export type DividerItem = { id: string; kind: "divider" };
/**
 * A box that lays out what is in it: a row side by side (each part sharing the row, stacked on a narrow screen), a column one under
 * the other. Boxes nest (a row of two columns, each with fields) — FLEX_DEPTH deep at most. Layout only: nothing of it is asked.
 */
export type FlexItem = { id: string; kind: "flex"; dir: "row" | "col"; gap?: "sm" | "md" | "lg"; items: FormItem[] };
/**
 * The database's own rows, each a line to change in place (a medicine to tick: "☑ Venlafaxin — 225 mg — 10:10"): the columns `cols`
 * of every row, prefilled with what it holds. Sent, the rows are changed — no row is made for it. `stamp`: when the checkbox `check`
 * is ticked (it wasn't), the date `time` is set to now.
 */
export type RowsItem = { id: string; kind: "rows"; cols: string[]; stamp?: { check: string; time: string }; label?: string; help?: string };
export type FormItem = FieldItem | HeadingItem | TextItem | DividerItem | FlexItem | RowsItem;
export type FormStep = { id: string; title: string; items: FormItem[] };
/** A form: the database it fills (null: not chosen yet), its words, and its steps (one: a plain form; several: a wizard). */
export type FormDef = { dbId: number | null; title: string; intro: string; submitLabel: string; thanks: string; steps: FormStep[] };
/** The answers as the form holds them, by property id (TITLE for the title): texts, a choice's option id, ids of people and rows. */
export type Answers = Record<string, unknown>;

/** The kinds of column a rows item can show and change (a line each: no lists of tags, people or rows in it). */
export const ROWS_COL_TYPES: PropType[] = ["checkbox", "number", "date", "select", "status", "text", "markdown", "url", "email", "phone"];
export const ROWS_MAX_COLS = 8;

/** How deep boxes (rows, columns) may nest in a form. */
export const FLEX_DEPTH = 3;
export const FORM_LIMITS = { steps: 20, items: 150, title: 200, intro: 2000, submit: 60, thanks: 1000, label: 200, help: 500, placeholder: 200, default: 500, heading: 200, text: 2000, step: 120, value: 200 } as const;

/** Properties a form can't offer although their type would do: what Zeff keeps for itself (a ticket's key, a source's reference). */
const KEPT = new Set([...SYSTEM_PROPS, "srcurl"]);

/** The title as a property a form can ask (it has no property of its own in a schema). */
export const titleProp = (titleName: string): Property => ({ id: TITLE, name: titleName || "Name", type: "text" });

/** What a form of this database can ask: the title first, then its properties that a form can fill. */
export function formProps(schema: { titleName: string; properties: Property[] }): Property[] {
  return [titleProp(schema.titleName), ...schema.properties.filter((p) => FORM_FIELD_TYPES.includes(p.type) && !isComputed(p) && !KEPT.has(p.id) && !p.relationSource)];
}

export const formItemId = (): string => newId("f");
export const newStep = (title = ""): FormStep => ({ id: newId("s"), title, items: [] });
export const fieldItem = (prop: string, extra: Partial<FieldItem> = {}): FieldItem => ({ id: formItemId(), kind: "field", prop, width: "full", ...extra });

/** Every part of these, boxes and what is in them (depth first, in the order they show). */
export const flatItems = (items: FormItem[]): FormItem[] => items.flatMap((i) => (i.kind === "flex" ? [i, ...flatItems(i.items)] : [i]));
/** The rows items among these parts, those in boxes too. */
export const rowsIn = (items: FormItem[]): RowsItem[] => flatItems(items).filter((i): i is RowsItem => i.kind === "rows");
export const formRowsItems = (def: FormDef): RowsItem[] => def.steps.flatMap((s) => rowsIn(s.items));

/**
 * A rows item's columns for a database: those it can change (`props`: formProps), each once, at most ROWS_MAX_COLS; the stamp kept
 * when its checkbox and its date are among them.
 */
export function rowsCols(cols: string[], stamp: RowsItem["stamp"], props?: Property[]): Pick<RowsItem, "cols" | "stamp"> {
  const ok = [...new Set(cols)].filter((c) => c !== TITLE && (!props || props.some((p) => p.id === c && ROWS_COL_TYPES.includes(p.type)))).slice(0, ROWS_MAX_COLS);
  const type = (id: string) => props?.find((p) => p.id === id)?.type;
  const keep = !!stamp && ok.includes(stamp.check) && ok.includes(stamp.time) && stamp.check !== stamp.time && (!props || (type(stamp.check) === "checkbox" && type(stamp.time) === "date"));
  return { cols: ok, ...(keep ? { stamp: { check: stamp!.check, time: stamp!.time } } : {}) };
}

/** A new rows item: the columns a line can change (as many as fit), stamped when there is one checkbox and one date among them. */
export function newRowsItem(props: Property[]): RowsItem {
  const cols = props.filter((p) => p.id !== TITLE && ROWS_COL_TYPES.includes(p.type)).slice(0, ROWS_MAX_COLS);
  const checks = cols.filter((p) => p.type === "checkbox");
  const dates = cols.filter((p) => p.type === "date");
  return { id: formItemId(), kind: "rows", cols: cols.map((p) => p.id), ...(checks.length === 1 && dates.length === 1 ? { stamp: { check: checks[0].id, time: dates[0].id } } : {}) };
}

/** Now as a date with its time ("2026-10-29T10:10", local) — what a stamp sets. */
export const stampNow = (d = new Date()): string => `${d.toLocaleDateString("sv-SE")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The fields among these parts, those in boxes too. */
export const fieldsIn = (items: FormItem[]): FieldItem[] => flatItems(items).filter((i): i is FieldItem => i.kind === "field");

/** A new form of a database: one step asking the title (required). */
export function newFormDef(dbId: number | null): FormDef {
  return { dbId, title: "", intro: "", submitLabel: "", thanks: "", steps: [{ ...newStep(), items: dbId ? [fieldItem(TITLE, { required: true })] : [] }] };
}

/** The kinds of field that sit half wide in a form made from a table (a short answer: two side by side). */
const HALF_TYPES: PropType[] = ["number", "date", "checkbox", "select", "status", "url", "email", "phone", "person"];

/** A form made from a table: one step asking every column it can (`props`: formProps) — the title first and required, short ones half wide. */
export function tableFormDef(dbId: number, props: Property[]): FormDef {
  const items = props.map((p) => fieldItem(p.id, { ...(p.id === TITLE ? { required: true as const } : {}), width: HALF_TYPES.includes(p.type) && p.id !== TITLE ? "half" : "full" }));
  return { dbId, title: "", intro: "", submitLabel: "", thanks: "", steps: [{ ...newStep(), items }] };
}

/** Whether a database's "New" offers "New with a form …": no entry form yet, and 3 or more columns a form can ask (the title too). */
export const offersEntryForm = (schema: { titleName: string; properties: Property[]; entryForm?: number }): boolean => !schema.entryForm && formProps(schema).length >= 3;

/**
 * A view's context (the cells a new row gets there: a board column's value, a calendar day, a group's) as the first answers of a
 * form — only for the fields it asks (shows), each as its control holds it (a day for a date, a number as words, lists as lists).
 */
export function prefillAnswers(def: FormDef, props: Property[], cells: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const f of formFields(def)) {
    const p = props.find((x) => x.id === f.prop);
    const raw = cells[f.prop];
    if (f.hidden || !p || raw === undefined || raw === null) continue;
    const v = typeof raw === "object" && !Array.isArray(raw) && "start" in raw ? (raw as { start: unknown }).start : raw;
    if (p.type === "multi_select" || p.type === "person" || p.type === "relation") {
      const list = (Array.isArray(v) ? v : [v]).filter((x) => (p.type === "multi_select" ? typeof x === "string" && !!p.options?.some((o) => o.id === x) : Number.isInteger(x) && (x as number) > 0));
      if (list.length) out[f.prop] = list;
    } else if (p.type === "checkbox") out[f.prop] = v === true;
    else if (p.type === "select" || p.type === "status") {
      if (p.options?.some((o) => o.id === v)) out[f.prop] = v;
    } else if (p.type === "date") {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) out[f.prop] = v.slice(0, 10);
    } else if ((typeof v === "string" || typeof v === "number") && String(v).trim()) out[f.prop] = String(v);
  }
  return out;
}

const str = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");
const okId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

/**
 * A form as it may be kept: known parts only, words bounded, ids unique, each property asked once, a condition only on another
 * field of the form, at least one step. With `props` (what the database can ask: formProps), fields of other properties go.
 */
export function normalizeForm(raw: unknown, props?: Property[]): FormDef {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dbId = Number.isInteger(o.dbId) && (o.dbId as number) > 0 ? (o.dbId as number) : null;
  const seen = new Set<string>();
  const asked = new Set<string>();
  const uid = (v: unknown, make: () => string): string => {
    const id = okId(v) && !seen.has(v) ? v : make();
    seen.add(id);
    return id;
  };
  let count = 0;
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, FORM_LIMITS.steps).map((s): FormStep => {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const list = (raw: unknown, depth: number): FormItem[] => (Array.isArray(raw) ? raw : []).flatMap((it): FormItem[] => {
      if (!it || typeof it !== "object" || ++count > FORM_LIMITS.items) return [];
      const i = it as Record<string, unknown>;
      if (i.kind === "rows") {
        const st = (i.stamp && typeof i.stamp === "object" ? i.stamp : null) as Record<string, unknown> | null;
        const stamp = st && typeof st.check === "string" && typeof st.time === "string" ? { check: st.check, time: st.time } : undefined;
        const { cols, stamp: kept } = rowsCols((Array.isArray(i.cols) ? i.cols : []).filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 60)), stamp, props);
        return [{ id: uid(i.id, formItemId), kind: "rows", cols, ...(kept ? { stamp: kept } : {}), ...(str(i.label, FORM_LIMITS.label) ? { label: str(i.label, FORM_LIMITS.label) } : {}), ...(str(i.help, FORM_LIMITS.help) ? { help: str(i.help, FORM_LIMITS.help) } : {}) }];
      }
      if (i.kind === "flex") {
        // (A box deeper than allowed is left out with what is in it.)
        if (depth >= FLEX_DEPTH) return [];
        const id = uid(i.id, formItemId);
        return [{ id, kind: "flex", dir: i.dir === "col" ? "col" : "row", ...(i.gap === "sm" || i.gap === "lg" ? { gap: i.gap } : {}), items: list(i.items, depth + 1) }];
      }
      if (i.kind === "heading") return [{ id: uid(i.id, formItemId), kind: "heading", text: str(i.text, FORM_LIMITS.heading) }];
      if (i.kind === "text") return [{ id: uid(i.id, formItemId), kind: "text", text: str(i.text, FORM_LIMITS.text) }];
      if (i.kind === "divider") return [{ id: uid(i.id, formItemId), kind: "divider" }];
      if (i.kind !== "field" || typeof i.prop !== "string" || !i.prop || asked.has(i.prop)) return [];
      if (props && !props.some((p) => p.id === i.prop)) return [];
      asked.add(i.prop);
      const w = (i.when && typeof i.when === "object" ? i.when : null) as Record<string, unknown> | null;
      const when: FormCond | undefined = w && typeof w.prop === "string" && w.prop && (COND_OPS as readonly unknown[]).includes(w.op) ? { prop: w.prop, op: w.op as CondOp, ...(w.op !== "filled" && w.op !== "empty" ? { value: str(w.value, FORM_LIMITS.value) } : {}) } : undefined;
      const field: FieldItem = {
        id: uid(i.id, formItemId),
        kind: "field",
        prop: i.prop.slice(0, 60),
        ...(str(i.label, FORM_LIMITS.label) ? { label: str(i.label, FORM_LIMITS.label) } : {}),
        ...(str(i.help, FORM_LIMITS.help) ? { help: str(i.help, FORM_LIMITS.help) } : {}),
        ...(str(i.placeholder, FORM_LIMITS.placeholder) ? { placeholder: str(i.placeholder, FORM_LIMITS.placeholder) } : {}),
        ...(i.required === true && i.hidden !== true ? { required: true as const } : {}),
        ...(i.hidden === true ? { hidden: true as const } : {}),
        ...(str(i.default, FORM_LIMITS.default) ? { default: str(i.default, FORM_LIMITS.default) } : {}),
        width: i.width === "half" ? "half" : "full",
        ...(when ? { when } : {}),
      };
      return [field];
    });
    const items = list(x.items, 0);
    return { id: uid(x.id, () => newId("s")), title: str(x.title, FORM_LIMITS.step), items };
  });
  // A condition only on another field the form asks (one that is gone, or itself, would hide the field for good).
  for (const s of steps) for (const it of fieldsIn(s.items)) if (it.when && (it.when.prop === it.prop || !asked.has(it.when.prop))) delete it.when;
  return { dbId, title: str(o.title, FORM_LIMITS.title), intro: str(o.intro, FORM_LIMITS.intro), submitLabel: str(o.submitLabel, FORM_LIMITS.submit), thanks: str(o.thanks, FORM_LIMITS.thanks), steps: steps.length ? steps : [newStep()] };
}

export const formFields = (def: FormDef): FieldItem[] => def.steps.flatMap((s) => fieldsIn(s.items));
export const fieldLabel = (f: FieldItem, p: Property | undefined): string => f.label || p?.name || f.prop;

const yes = (v: unknown) => v === true || /^(1|true|yes|ja|y|x|✓)$/i.test(String(v ?? "").trim());
const optionOf = (p: Property, v: unknown) => p.options?.find((o) => o.id === v) ?? p.options?.find((o) => o.name.toLowerCase() === String(v ?? "").trim().toLowerCase());
const today = () => new Date().toLocaleDateString("sv-SE");

/** A field's default (kept as words) as an answer: a choice by its id or name, several by commas, "today" for a date, ids of people and rows. */
export function defaultAnswer(p: Property, raw: string | undefined): unknown {
  if (raw === undefined || raw === "") return p.type === "checkbox" ? false : p.type === "multi_select" || p.type === "person" || p.type === "relation" ? [] : "";
  if (p.type === "checkbox") return yes(raw);
  if (p.type === "select" || p.type === "status") return optionOf(p, raw)?.id ?? "";
  if (p.type === "multi_select") return raw.split(/\s*,\s*/).map((x) => optionOf(p, x)?.id).filter((x): x is string => !!x);
  if (p.type === "person" || p.type === "relation") return raw.split(/\s*,\s*/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (p.type === "date" && raw.trim().toLowerCase() === "today") return today();
  return raw;
}

/**
 * Answers as a caller may give them (an API, an old block, a script) made the form's own: a choice by its name as well as its id,
 * several by a list or commas, a tick as "yes"/"true", people and rows as ids. What doesn't fit is left as it is — the check says so.
 */
export function coerceAnswers(answers: Answers, props: Property[]): Answers {
  const out: Answers = { ...answers };
  for (const p of props) {
    const v = out[p.id];
    if (v === undefined || v === null) continue;
    const list = Array.isArray(v) ? v : String(v).trim() ? String(v).split(/\s*,\s*/) : [];
    if (p.type === "checkbox") out[p.id] = yes(v);
    else if ((p.type === "select" || p.type === "status") && !Array.isArray(v)) out[p.id] = optionOf(p, v)?.id ?? v;
    else if (p.type === "multi_select") out[p.id] = list.map((x) => optionOf(p, x)?.id ?? x);
    else if (p.type === "person" || p.type === "relation") out[p.id] = list.map((x) => (/^\d+$/.test(String(x).trim()) ? Number(x) : x));
  }
  return out;
}

/** Whether an answer is no answer (a checkbox: not ticked). */
export function isBlank(p: Property | undefined, v: unknown): boolean {
  if (p?.type === "checkbox") return !yes(v);
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}

/** Whether a condition holds for an answer — compared as words, without case; several values (tags, people): any of them. */
export function condHolds(c: FormCond, p: Property | undefined, v: unknown): boolean {
  if (c.op === "filled") return !isBlank(p, v);
  if (c.op === "empty") return isBlank(p, v);
  const want = String(c.value ?? "").trim().toLowerCase();
  const have = p?.type === "checkbox" ? [yes(v) ? "true" : "false"] : (Array.isArray(v) ? v : isBlank(p, v) ? [] : [v]).map((x) => String(x).trim().toLowerCase());
  // (A choice may be named by its option's name as well as its id.)
  const names = p?.options ? have.map((x) => p.options!.find((o) => o.id.toLowerCase() === x)?.name.toLowerCase() ?? x) : have;
  const eq = have.includes(want) || names.includes(want);
  if (c.op === "eq") return eq;
  if (c.op === "neq") return !eq;
  return have.some((x) => x.includes(want)) || names.some((x) => x.includes(want));
}

/** The answers with what the form sets by itself: the defaults of the fields it doesn't ask. */
export function withHiddenDefaults(def: FormDef, answers: Answers, props: Property[]): Answers {
  const out = { ...answers };
  for (const f of formFields(def)) if (f.hidden) out[f.prop] = defaultAnswer(props.find((p) => p.id === f.prop) ?? titleProp(""), f.default);
  return out;
}

/**
 * The fields whose condition holds for these answers (their item ids): those without one, and those whose condition holds — on a
 * field that holds itself (a field off by its own condition counts as empty). A field not asked (hidden) is in it too: its value counts.
 */
export function liveFields(def: FormDef, answers: Answers, props: Property[]): Set<string> {
  const fields = formFields(def);
  const byProp = new Map(fields.map((f) => [f.prop, f]));
  const memo = new Map<string, boolean>();
  const live = (f: FieldItem, path: Set<string>): boolean => {
    if (memo.has(f.id)) return memo.get(f.id)!;
    if (path.has(f.id)) return false; // (conditions in a circle: none of them holds)
    path.add(f.id);
    let on = true;
    if (f.when) {
      const ref = byProp.get(f.when.prop);
      const refOn = !!ref && live(ref, path);
      on = condHolds(f.when, props.find((x) => x.id === f.when!.prop), refOn ? answers[f.when.prop] : undefined);
    }
    path.delete(f.id);
    memo.set(f.id, on);
    return on;
  };
  return new Set(fields.filter((f) => live(f, new Set())).map((f) => f.id));
}

/** The fields that show (are asked) for these answers: the live ones that aren't hidden. */
export function shownFields(def: FormDef, answers: Answers, props: Property[]): Set<string> {
  const live = liveFields(def, answers, props);
  return new Set(formFields(def).filter((f) => live.has(f.id) && !f.hidden).map((f) => f.id));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i;
const PHONE = /^\+?[\d\s()/.-]{3,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What is wrong with the answers, by item id (none: all fine): required fields that are empty, values that don't fit their field —
 * among the fields that show (of one step, `stepId`, or all). Said in the words of `t` (the browser's language, or the server's).
 */
export function formErrors(def: FormDef, answers: Answers, props: Property[], t: T, stepId?: string): Record<string, string> {
  const all = withHiddenDefaults(def, answers, props);
  const shown = shownFields(def, all, props);
  const out: Record<string, string> = {};
  for (const s of def.steps) {
    if (stepId && s.id !== stepId) continue;
    for (const f of fieldsIn(s.items)) {
      if (!shown.has(f.id)) continue;
      const p = props.find((x) => x.id === f.prop);
      if (!p) continue;
      const field = fieldLabel(f, p);
      const v = all[f.prop];
      if (isBlank(p, v)) {
        if (f.required) out[f.id] = p.type === "checkbox" ? t("Please tick “{field}”.", { field }) : t("Please fill in “{field}”.", { field });
        continue;
      }
      const text = String(v).trim();
      if (p.type === "number" && !Number.isFinite(Number(text.replace(",", ".")))) out[f.id] = t("“{field}” needs a number.", { field });
      else if (p.type === "email" && !EMAIL.test(text)) out[f.id] = t("“{field}” needs an email address, like name@example.com.", { field });
      else if (p.type === "url" && !URL_RE.test(text)) out[f.id] = t("“{field}” needs a web address, like https://example.com.", { field });
      else if (p.type === "phone" && !PHONE.test(text)) out[f.id] = t("“{field}” needs a phone number.", { field });
      else if (p.type === "date" && !DATE.test(text)) out[f.id] = t("“{field}” needs a date.", { field });
      else if ((p.type === "select" || p.type === "status") && !p.options?.some((o) => o.id === v)) out[f.id] = t("Please choose one of the choices for “{field}”.", { field });
      else if (p.type === "multi_select" && (!Array.isArray(v) || v.some((x) => !p.options?.some((o) => o.id === x)))) out[f.id] = t("Please choose among the choices for “{field}”.", { field });
      else if ((p.type === "person" || p.type === "relation") && (!Array.isArray(v) || v.some((x) => !Number.isInteger(x) || (x as number) <= 0))) out[f.id] = t("Please pick from the list for “{field}”.", { field });
    }
  }
  return out;
}

/**
 * The row the answers make: its title and cells — only fields that show (or aren't asked, their default), each as its cell keeps
 * it (a number as a number, a choice by its option id, people and rows as ids). Check them with formErrors first.
 */
export function formCells(def: FormDef, answers: Answers, props: Property[]): { title: string; cells: Record<string, unknown> } {
  const all = withHiddenDefaults(def, answers, props);
  const live = liveFields(def, all, props);
  let title = "";
  const cells: Record<string, unknown> = {};
  for (const f of formFields(def)) {
    if (!live.has(f.id)) continue;
    const p = props.find((x) => x.id === f.prop);
    const v = all[f.prop];
    if (!p || isBlank(p, v)) continue;
    if (f.prop === TITLE) title = String(v).trim();
    else if (p.type === "number") cells[p.id] = Number(String(v).trim().replace(",", "."));
    else if (p.type === "checkbox") cells[p.id] = true;
    else if (Array.isArray(v)) cells[p.id] = [...new Set(v)];
    else if (p.type === "url" && !/^[a-z][\w+.-]*:/i.test(String(v).trim())) cells[p.id] = `https://${String(v).trim()}`;
    else cells[p.id] = typeof v === "string" ? v.trim() : v;
  }
  return { title, cells };
}

/** The answers a form starts with: each field's default (a field not asked too — its value is what conditions see). */
export function startAnswers(def: FormDef, props: Property[]): Answers {
  const out: Answers = {};
  for (const f of formFields(def)) {
    const p = props.find((x) => x.id === f.prop);
    if (p) out[f.prop] = defaultAnswer(p, f.default);
  }
  return out;
}
