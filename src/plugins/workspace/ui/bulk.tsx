"use client";

import { useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { archiveRowsAction, bulkSetAction, databasesAction, moveRowsAction, restorePageAction } from "../actions";
import { isComputed, type DbSchema, type Property } from "../model";
import { Dropdown } from "./kit";

/**
 * What can be done with several selected rows at once: set one field for all of them, move them to another database, send them to
 * the trash (with "Undo"). Shown above a table while rows are ticked.
 */

const SETTABLE = (p: Property) => !isComputed(p) && !["person", "relation", "todo", "ai"].includes(p.type) && !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id);

function ValueInput({ p, value, onChange }: { p: Property; value: unknown; onChange: (v: unknown) => void }) {
  const t = useT();
  if (p.type === "select" || p.type === "status")
    return (
      <select className="input w-auto text-sm" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} aria-label={t("Value")}>
        <option value="">{t("(empty)")}</option>
        {(p.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  if (p.type === "multi_select")
    return (
      <div className="flex max-w-64 flex-wrap gap-1">
        {(p.options ?? []).map((o) => {
          const on = Array.isArray(value) && value.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} className={`ws-tag ${on ? "" : "opacity-40"}`} data-color={o.color} onClick={() => onChange(on ? (value as string[]).filter((x) => x !== o.id) : [...(Array.isArray(value) ? value : []), o.id])}>
              {o.name}
            </button>
          );
        })}
      </div>
    );
  if (p.type === "checkbox")
    return (
      <select className="input w-auto text-sm" value={value === true ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "yes")} aria-label={t("Value")}>
        <option value="yes">{t("Checked")}</option>
        <option value="no">{t("Not checked")}</option>
      </select>
    );
  return <input className="input w-48 text-sm" type={p.type === "number" ? "number" : p.type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(e) => onChange(p.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} aria-label={t("Value")} />;
}

export function BulkBar({ ids, schema, dbId, onChanged, onClear }: { ids: number[]; schema: DbSchema; dbId: number; onChanged: () => void; onClear: () => void }) {
  const t = useT();
  const [prop, setProp] = useState("");
  const [value, setValue] = useState<unknown>(null);
  const [databases, setDatabases] = useState<{ id: number; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void databasesAction().then((r) => r.ok && setDatabases(r.databases.filter((d) => d.id !== dbId).map((d) => ({ id: d.id, title: d.title }))));
  }, [dbId]);
  const p = schema.properties.find((x) => x.id === prop);

  const set = async (close: () => void) => {
    if (!p) return;
    setBusy(true);
    const r = await bulkSetAction(ids, p.id, value);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    close();
    toast(r.failed.length ? t("{done} of {n} set — {why}", { done: r.done, n: ids.length, why: r.failed[0] }) : t("{field} set for {n} rows.", { field: p.name, n: ids.length }), { tone: r.failed.length ? "error" : "ok" });
    onChanged();
  };
  const move = async (target: { id: number; title: string }, close: () => void) => {
    if (!confirmAction(t("Move {n} rows to “{db}”? They leave this database (cells that have no counterpart there are dropped).", { n: ids.length, db: target.title }))) return;
    setBusy(true);
    const r = await moveRowsAction(ids, target.id);
    setBusy(false);
    close();
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(r.dropped.length ? t("{n} rows moved to “{db}” — not carried over: {fields}.", { n: r.moved.length, db: target.title, fields: r.dropped.join(", ") }) : t("{n} rows moved to “{db}”.", { n: r.moved.length, db: target.title }), { tone: "ok" });
    onClear();
    onChanged();
  };
  const trash = async () => {
    if (!confirmAction(t("Move {n} rows to the trash?", { n: ids.length }))) return;
    setBusy(true);
    const r = await archiveRowsAction(ids);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(r.kept.length ? t("{n} to the trash — {why}", { n: r.gone.length, why: r.kept[0] }) : t("{n} rows moved to the trash.", { n: r.gone.length }), {
      tone: r.kept.length ? "error" : "ok",
      action: r.gone.length
        ? {
            label: t("Undo"),
            run: async () => {
              for (const id of r.gone) await restorePageAction(id);
              onChanged();
            },
          }
        : undefined,
    });
    onClear();
    onChanged();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/40" role="region" aria-label={t("Selected rows")}>
      <span className="font-medium">{t("{n} selected", { n: ids.length })}</span>
      <Dropdown label={`✎ ${t("Set a field …")}`} className="btn btn-sm">
        {(close) => (
          <div className="w-72 space-y-2 p-2">
            <select className="input text-sm" value={prop} onChange={(e) => (setProp(e.target.value), setValue(null))} aria-label={t("Field")}>
              <option value="">{t("Pick a field …")}</option>
              {schema.properties.filter(SETTABLE).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            {p && <ValueInput p={p} value={value} onChange={setValue} />}
            <button type="button" className="btn btn-primary btn-sm" disabled={!p || busy} onClick={() => void set(close)}>
              {t("Set for {n} rows", { n: ids.length })}
            </button>
          </div>
        )}
      </Dropdown>
      <Dropdown label={`➜ ${t("Move to …")}`} className="btn btn-sm">
        {(close) => (
          <div className="max-h-72 w-64 overflow-y-auto p-1">
            {databases.map((d) => (
              <button key={d.id} type="button" disabled={busy} className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => void move(d, close)}>
                🗂 {d.title || t("Untitled")}
              </button>
            ))}
            {!databases.length && <p className="px-2 py-1.5 text-xs text-zinc-500">{t("No other database.")}</p>}
          </div>
        )}
      </Dropdown>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void trash()}>
        🗑 {t("Delete")}
      </button>
      <span className="flex-1" />
      <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={onClear}>
        {t("Clear")}
      </button>
    </div>
  );
}
