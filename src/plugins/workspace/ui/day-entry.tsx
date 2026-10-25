"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { dayEntryAction } from "../actions";

type Table = { titleName: string; fields: string[]; items: { name: string; cells: string[] }[] };

/**
 * A day's entry of a daily list's log (day-log.ts) as the list looks: a row per item, a column per field. Its fields one by one (as
 * every row shows them) folded away under it. Anything else: just those fields.
 */
export function DayEntry({ rowId, fields }: { rowId: number; fields: ReactNode }) {
  const t = useT();
  const [table, setTable] = useState<Table | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void dayEntryAction(rowId).then((r) => live && setTable(r.ok ? r.table : null));
    return () => {
      live = false;
    };
  }, [rowId]);
  if (!table) return <>{fields}</>;
  return (
    <div className="mb-6 space-y-3">
      {/* (As a database's table is drawn — DatabaseView: its frame, its header, each value in a ws-cell.) */}
      <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="ws-table">
          <thead>
            <tr>
              <th className="min-w-56">{table.titleName}</th>
              {table.fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.items.map((i) => (
              <tr key={i.name}>
                <td>
                  <div className="ws-cell">{i.name}</div>
                </td>
                {i.cells.map((c, n) => (
                  <td key={n}>
                    <div className="ws-cell tabular-nums">{c}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">{t("Fields")}</summary>
        <div className="mt-2">{fields}</div>
      </details>
    </div>
  );
}
