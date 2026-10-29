"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formulaNamesAction, setTableShareAction } from "../actions";
import { colLetters } from "../formula";
import { sheetColumns, sheetRef, TITLE, type DbSchema } from "../model";
import { Modal } from "./kit";

/**
 * A table as a spreadsheet, in the UI: its columns' letters (A = the first of its first table view), sharing it for other
 * tables' formulas under a name (its ⋯ menu), and the help under a cell while a formula is typed — the letters, this row's
 * number, the Kennzahlen to pick after @, the shared tables.
 */

/** The columns as letters: A = Name, B = Betrag … */
export function columnLetters(schema: DbSchema): { letter: string; name: string }[] {
  return sheetColumns(schema).flatMap((id, i) => {
    const name = id === TITLE ? schema.titleName : schema.properties.find((p) => p.id === id)?.name;
    return name ? [{ letter: colLetters(i), name }] : [];
  });
}

/** The ⋯ menu's "Share for formulas": on or off, under which name — and how other tables then read it. */
export function ShareDialog({ dbId, schema, title, onDone, onClose }: { dbId: number; schema: DbSchema; title: string; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const [on, setOn] = useState(!!schema.share);
  const [name, setName] = useState(schema.share?.name ?? title.replace(/[^\p{L}\p{N}_ -]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60));
  const [busy, setBusy] = useState(false);
  const ref = sheetRef(name.trim() || "Tabelle");
  const cols = columnLetters(schema);
  const second = cols[1] ?? cols[0];
  const save = async () => {
    setBusy(true);
    const r = await setTableShareAction(dbId, on ? name : null);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(on ? t("Shared — other tables read it as {ref}", { ref: `${ref}!A1` }) : t("Not shared any more."), { tone: "ok" });
    onDone();
    onClose();
  };
  return (
    <Modal title={t("Share for formulas")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>
            <span className="font-medium">{t("Other tables may read this one")}</span>
            <span className="block text-xs text-zinc-500">{t("A cell of another table that starts with = can then name its cells, columns and ranges — like a sheet of a workbook.")}</span>
          </span>
        </label>
        {on && (
          <label className="block space-y-1">
            <span className="label">{t("Its name in formulas")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          </label>
        )}
        {on && second && (
          <div className="space-y-1 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
            <p className="font-medium">{t("Read it from another table like this")}</p>
            <ul className="space-y-0.5 font-mono">
              <li>={ref}!{second.letter}1</li>
              <li>=SUMME({ref}!{second.letter}:{second.letter})</li>
              <li>=SUMME({ref}[{second.name}])</li>
              <li>=MITTELWERT({ref}!{second.letter}1:{second.letter}10)</li>
            </ul>
          </div>
        )}
        <ColumnLegend schema={schema} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || (on && !name.trim())} onClick={() => void save()}>
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The letters of the columns (A = Name …): how cells and ranges are named. */
export function ColumnLegend({ schema, row }: { schema: DbSchema; row?: number }) {
  const t = useT();
  return (
    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-500">
      {columnLetters(schema).map((c) => (
        <span key={c.letter}>
          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">{c.letter}</span> {c.name}
        </span>
      ))}
      {row !== undefined && (
        <span>
          · {t("this row")} <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">{row}</span>
        </span>
      )}
    </p>
  );
}

/** The Kennzahlen and shared tables, read once per page (what @ and Name! can name). */
let names: Promise<{ metrics: string[]; tables: { name: string; title: string }[] }> | null = null;
const loadNames = () =>
  (names ??= formulaNamesAction().then((r) => (r.ok ? { metrics: r.metrics, tables: r.tables } : { metrics: [], tables: [] }), () => ({ metrics: [], tables: [] })));

/** @Sparrate, or @[Frei im Monat] when the name has more than a word. */
export const metricRef = (name: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? `@${name}` : `@[${name}]`);

/**
 * The help under a cell while "=…" is typed: the columns' letters and this row's number, the Kennzahlen matching what follows
 * an @ (a click puts it in), the tables shared for formulas.
 */
export function FormulaHelp({ schema, row, text, onPick }: { schema: DbSchema; row?: number; text: string; onPick: (next: string) => void }) {
  const t = useT();
  const [n, setN] = useState<{ metrics: string[]; tables: { name: string; title: string }[] } | null>(null);
  useEffect(() => {
    let live = true;
    void loadNames().then((x) => live && setN(x));
    return () => {
      live = false;
    };
  }, []);
  const at = /@(\[[^\]]*|[\p{L}\p{N}_]*)$/u.exec(text);
  const q = (at?.[1] ?? "").replace(/^\[/, "").toLowerCase();
  const metrics = at ? (n?.metrics ?? []).filter((m) => m.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div className="space-y-1 px-1" onMouseDown={(e) => e.preventDefault()}>
      {/* The whole formula (the cell is narrow). */}
      <p className="font-mono text-sm break-all text-zinc-800 dark:text-zinc-100">{text}</p>
      <ColumnLegend schema={schema} row={row} />
      {at ? (
        <div className="flex flex-wrap gap-1">
          {metrics.map((m) => (
            <button key={m} type="button" className="ws-tag" onClick={() => onPick(`${text.slice(0, at.index)}${metricRef(m)}`)}>
              @{m}
            </button>
          ))}
          {!metrics.length && <span className="text-xs text-zinc-500">{n ? t("No Kennzahl like that") : t("Loading …")}</span>}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {t("A1 · A1:B3 · B:B · [Column] · @Kennzahl · SUMME(…) · WENN(…; …; …)")}
          {n?.tables.length ? ` · ${n.tables.map((x) => `${sheetRef(x.name)}!A1`).join(" · ")}` : ""}
        </p>
      )}
    </div>
  );
}
