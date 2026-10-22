"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { CALC_FNS, formatNumber, rollup, type CalcFn, type Property, type Row, type View } from "../model";
import { publishValueAction, unpublishValueAction, valuesOfDbAction, type PublishedHere } from "../values-actions";

/**
 * A table's sum row: under each number column a calculation — sum, average, min, max, count — over the rows the view shows,
 * kept with the view. A calculation can be published under a name ("Fixkosten", picked from the names Zeff reads, or a new
 * one): every part of Zeff can read it then, live (the Finances plugin's debt overview counts it in).
 */

const NUMERIC = new Set(["number", "formula", "rollup"]);

export function useCalcLabels(): Record<CalcFn, string> {
  const t = useT();
  return { sum: t("Sum"), average: t("Average"), median: t("Median"), min: t("Min"), max: t("Max"), count: t("Count"), count_values: t("Count values") };
}

/** The values published from this database, and the names to pick from — read once per table, again after a change. */
export function usePublished(dbId: number) {
  const [state, setState] = useState<{ here: PublishedHere[]; names: { key: string; label: string; what: string; taken: boolean }[] }>({ here: [], names: [] });
  const load = () => void valuesOfDbAction(dbId).then((r) => r.ok && setState({ here: r.here, names: r.names }));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(load, [dbId]);
  return { ...state, reload: load };
}

/** One column's cell in the sum row. */
export function CalcCell({ p, view, rows, dbId, setView, published }: { p: Property | undefined; view: View; rows: Row[]; dbId: number; setView: (v: View) => void; published: ReturnType<typeof usePublished> }) {
  const t = useT();
  const labels = useCalcLabels();
  const [naming, setNaming] = useState<string | null>(null);
  if (!p || !NUMERIC.has(p.type)) return <td />;
  const fn = view.calcs?.[p.id];
  const value = fn ? rollup(fn, p, rows.map((r) => r.cells[p.id])) : null;
  const shown = typeof value === "number" && Number.isFinite(value) ? (fn === "count" || fn === "count_values" ? String(value) : formatNumber(p, Math.round(value * 100) / 100)) : "";
  const mine = published.here.find((x) => x.viewId === view.id && x.propId === p.id);
  const choose = (next: string) => {
    const calcs = { ...(view.calcs ?? {}) };
    if (next) calcs[p.id] = next as CalcFn;
    else delete calcs[p.id];
    setView({ ...view, calcs });
  };
  const publish = async (label: string) => {
    if (!fn || !label.trim()) return;
    const r = await publishValueAction({ label, dbId, viewId: view.id, propId: p.id, fn });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("“{name}” is now available in Zeff: {value}", { name: label.trim(), value: shown }));
    setNaming(null);
    published.reload();
  };
  return (
    <td className="group/calc align-top text-xs">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {fn && <span className="font-semibold text-zinc-700 tabular-nums dark:text-zinc-200">{shown || "—"}</span>}
        <select className={`rounded bg-transparent text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${fn ? "" : "opacity-0 group-hover/calc:opacity-100 focus:opacity-100"}`} value={fn ?? ""} onChange={(e) => choose(e.target.value)} aria-label={t("Calculate")}>
          <option value="">{fn ? t("None") : t("Calculate")}</option>
          {CALC_FNS.map((f) => (
            <option key={f} value={f}>
              {labels[f]}
            </option>
          ))}
        </select>
      </div>
      {fn && (
        <div className="mt-0.5 flex justify-end">
          {mine ? (
            <button type="button" className="rounded-full bg-emerald-50 px-1.5 text-[11px] text-emerald-700 hover:line-through dark:bg-emerald-950 dark:text-emerald-300" title={t("Available in Zeff as “{name}” — click to take it back", { name: mine.label })} onClick={() => void unpublishValueAction(mine.key).then(() => published.reload())}>
              = {mine.label}
            </button>
          ) : naming === null ? (
            <button type="button" className="text-[11px] text-indigo-600 opacity-0 group-hover/calc:opacity-100 hover:underline focus:opacity-100 dark:text-indigo-400" onClick={() => setNaming("")}>
              {t("Make available …")}
            </button>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void publish(naming);
              }}
            >
              <input className="input h-6 w-28 px-1.5 text-xs" list={`values-${dbId}`} autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={t("e.g. Fixkosten")} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
              <datalist id={`values-${dbId}`}>
                {published.names.map((n) => (
                  <option key={n.key} value={n.label}>
                    {n.what || (n.taken ? t("in use") : "")}
                  </option>
                ))}
              </datalist>
              <button className="btn btn-sm h-6 px-2 text-xs">{t("OK")}</button>
            </form>
          )}
        </div>
      )}
    </td>
  );
}
