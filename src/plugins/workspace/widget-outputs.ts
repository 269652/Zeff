import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { valueKey } from "./values";

/**
 * What widgets publish (zeff.publish): a named value — a number, a text, a list, a table (a list of rows), any JSON — that the
 * whole of Zeff can read, not just the widget's own page: other widgets anywhere go on computing with it (zeff.values.get), a view
 * shows it ({{ outputs.name }}, <datatable source="outputs.name">), a number is a Kennzahl (formulas, the Kennzahlen page, Today:
 * kennzahl("name")), the assistant and agents read it (workspace_widget_outputs) and can pour a table into a database.
 *
 * A name belongs to the widget block that published it first (its wid — or, outside a page, its code's key): another widget can't
 * overwrite it — except a changed version of the same widget (same page, same title): its code's key is new, the name is still its.
 * Server only.
 */

export const MAX_OUTPUT = 200_000;
const MAX_OUTPUTS = 500;

export type OutputKind = "number" | "text" | "list" | "table" | "json";
export type WidgetOutput = { key: string; label: string; kind: OutputKind; value: unknown; unit: string; owner: string; pageId: number | null; widget: string; updatedAt: string };

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_widget_outputs (key text primary key, label text not null, kind text not null, value text not null, unit text not null default '', owner text not null, page_id integer, widget text not null default '', updated_at text not null)");
  return d;
}

type ORow = { key: string; label: string; kind: string; value: string; unit: string; owner: string; page_id: number | null; widget: string; updated_at: string };
const toOutput = (r: ORow): WidgetOutput => {
  let value: unknown = null;
  try {
    value = JSON.parse(r.value);
  } catch {
    value = null;
  }
  return { key: r.key, label: r.label, kind: r.kind as OutputKind, value, unit: r.unit, owner: r.owner, pageId: r.page_id, widget: r.widget, updatedAt: r.updated_at };
};

/** What a value is: a number, a text, a list, a table (a list of objects — its rows), anything else JSON. */
export function kindOf(v: unknown): OutputKind {
  if (typeof v === "number" && Number.isFinite(v)) return "number";
  if (typeof v === "string") return "text";
  if (Array.isArray(v)) return v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? "table" : "list";
  return "json";
}

/**
 * A value published (or published again) under its name — by its owner (a block's wid, a widget's key). Null removes it. Throws
 * when the name is another widget's, or the value too big.
 */
export function publishOutput(name: string, value: unknown, by: { owner: string; pageId?: number | null; widget?: string; unit?: string; label?: string }): WidgetOutput | null {
  const label = String(by.label ?? name).trim().slice(0, 80);
  const key = valueKey(String(name ?? ""));
  if (!key) throw new Error("publish: a name (letters or digits).");
  if (!by.owner) throw new Error("publish: no widget.");
  const d = db();
  const had = d.prepare("select * from ws_widget_outputs where key = ?").get(key) as ORow | undefined;
  const sameWidget = !!had && had.page_id !== null && had.page_id === (by.pageId ?? null) && !!had.widget && had.widget === String(by.widget ?? "").slice(0, 80);
  if (had && had.owner !== by.owner && !sameWidget) throw new Error(`"${had.label}" is published by another widget${had.widget ? ` („${had.widget}“)` : ""} — pick another name.`);
  if (value === null || value === undefined) {
    if (had) d.prepare("delete from ws_widget_outputs where key = ?").run(key);
    emitChange("workspace");
    return null;
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("publish: a value JSON can hold.");
  }
  if (json.length > MAX_OUTPUT) throw new Error(`publish: too big (${MAX_OUTPUT} characters at most).`);
  if (!had && (d.prepare("select count(*) n from ws_widget_outputs").get() as { n: number }).n >= MAX_OUTPUTS) throw new Error(`Zeff keeps ${MAX_OUTPUTS} published values at most — remove some first.`);
  d.prepare(
    "insert into ws_widget_outputs (key, label, kind, value, unit, owner, page_id, widget, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(key) do update set owner = excluded.owner, label = excluded.label, kind = excluded.kind, value = excluded.value, unit = excluded.unit, page_id = excluded.page_id, widget = excluded.widget, updated_at = excluded.updated_at",
  ).run(key, label || key, kindOf(value), json, String(by.unit ?? "").slice(0, 20), by.owner, by.pageId ?? null, String(by.widget ?? "").slice(0, 80), new Date().toISOString());
  emitChange("workspace");
  return getOutput(key);
}

export function getOutput(name: string): WidgetOutput | null {
  const r = db().prepare("select * from ws_widget_outputs where key = ?").get(valueKey(String(name ?? ""))) as ORow | undefined;
  return r ? toOutput(r) : null;
}

/** Every published value (newest first); `values: false` — without them (a list to pick from). */
export function listOutputs(opts: { values?: boolean } = {}): WidgetOutput[] {
  return (db().prepare("select * from ws_widget_outputs order by updated_at desc").all() as ORow[]).map((r) => (opts.values === false ? { ...toOutput({ ...r, value: "null" }), value: undefined } : toOutput(r)));
}

/** Every value by its key — what a view reads as outputs.<key> (and by its name as written). */
export function outputsByKey(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of listOutputs()) {
    out[o.key] = o.value;
    if (o.label && o.label !== o.key) out[o.label] = o.value;
  }
  return out;
}

/** A published value removed (by the user — whoever owns it). */
export function removeOutput(name: string): boolean {
  const gone = db().prepare("delete from ws_widget_outputs where key = ?").run(valueKey(String(name ?? ""))).changes > 0;
  if (gone) emitChange("workspace");
  return gone;
}

/** A table (a list of rows) as cells by field name — rows to add to a database. */
export function tableRows(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)).slice(0, 2000);
}
