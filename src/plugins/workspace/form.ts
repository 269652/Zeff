import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { FORM_TYPES, isComputed, type FormField, type FormSpec, type Property } from "./model";
import { addRow, getDatabase } from "./store";

/**
 * A database's form (workspace/form/<id>): asks the fields the database lists - a title, then the fields in order, required ones
 * marked, hidden ones prefilled - and makes a row of the answers. What it may ask is the database's `form` (set in its menu). Server only.
 */

export type FormView = { id: number; database: string; spec: FormSpec; titleName: string; fields: { field: FormField; prop: Property }[] };

/** The form of a database as it is asked - null: there is none, or it is switched off. */
export function formFor(dbId: number): FormView | null {
  if (!isInstalled("workspace")) return null;
  const d = getDatabase(dbId);
  const spec = d?.schema.form;
  if (!d || d.page.archivedAt || !spec?.enabled) return null;
  const fields = spec.fields.flatMap((field) => {
    const prop = d.schema.properties.find((p) => p.id === field.prop);
    return prop && FORM_TYPES.includes(prop.type) && !isComputed(prop) ? [{ field, prop }] : [];
  });
  return { id: dbId, database: d.page.title || t("Untitled"), spec, titleName: d.schema.titleName, fields };
}

const yes = (v: unknown) => v === true || /^(1|true|yes|ja|y|x|✓)$/i.test(String(v ?? "").trim());

/** One answer as the cell takes it (a choice by its id or its name; several by names). null: nothing. */
function cellOf(p: Property, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return p.type === "checkbox" ? false : null;
  if (p.type === "checkbox") return yes(raw);
  if (p.type === "number") {
    const n = Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (p.type === "select" || p.type === "status") {
    const o = p.options?.find((x) => x.id === raw) ?? p.options?.find((x) => x.name.toLowerCase() === String(raw).toLowerCase());
    return o?.id ?? null;
  }
  if (p.type === "multi_select") {
    const list = (Array.isArray(raw) ? raw : String(raw).split(/\s*,\s*/)).map((x) => p.options?.find((o) => o.id === x)?.id ?? p.options?.find((o) => o.name.toLowerCase() === String(x).toLowerCase())?.id).filter((x): x is string => !!x);
    return list.length ? list : null;
  }
  return String(raw);
}

/** An answered form: the row it makes. Required fields that are empty are told, none made then. */
export function submitForm(dbId: number, title: string, answers: Record<string, unknown>): number {
  const form = formFor(dbId);
  if (!form) throw new Error(t("This form is not there (or switched off)."));
  const missing: string[] = [];
  if (form.spec.titleRequired && !title.trim()) missing.push(form.spec.titleLabel || form.titleName);
  const cells: Record<string, unknown> = {};
  for (const { field, prop } of form.fields) {
    const given = field.hidden ? field.default : (answers[prop.id] ?? field.default);
    const cell = cellOf(prop, given);
    if (!field.hidden && field.required && (cell === null || cell === "" || (prop.type === "checkbox" && cell !== true))) missing.push(field.label || prop.name);
    if (cell !== null && !(prop.type === "checkbox" && cell === false && !field.default)) cells[prop.id] = cell;
  }
  if (missing.length) throw new Error(t("Please fill in: {fields}.", { fields: missing.join(", ") }));
  return addRow(dbId, { title: title.trim(), cells });
}
