"use client";

import { useT } from "@/components/I18nProvider";
import { groupRows } from "../../model";
import { PopCell } from "../cells";
import type { ViewProps } from "./shared";
import { RowMenu } from "./row-menu";

export function ListView({ view, rows, visible, schema, ctx, api, labels, openRow }: ViewProps) {
  const t = useT();
  const groups = view.groupBy ? groupRows(rows, view.groupBy, schema.properties, labels).filter((g) => !view.hideEmpty || g.rows.length) : [{ key: "", label: "", color: undefined as string | undefined, rows }];
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key || "all"}>
          {view.groupBy && <div className="mb-1 flex items-center gap-2 text-sm">{g.color ? <span className="ws-tag" data-color={g.color}>{g.label}</span> : <span className="font-medium text-zinc-500">{g.key ? g.label : t("No value")}</span>}<span className="text-zinc-400">{g.rows.length}</span></div>}
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {g.rows.map((r) => (
              <li key={r.id} className="group/row flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                <span>{r.icon || "📄"}</span>
                <button type="button" className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => openRow(r.id)}>
                  {r.title || <span className="text-zinc-400">{t("Untitled")}</span>}
                </button>
                <span className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                  {visible.slice(0, 5).map((p) => (
                    <PopCell key={p.id} p={p} row={r} ctx={ctx} />
                  ))}
                </span>
                <span className="opacity-0 group-hover/row:opacity-100">
                  <RowMenu row={r} api={api} />
                </span>
              </li>
            ))}
            {!g.rows.length && <li className="px-2 py-2 text-xs text-zinc-400">{t("Empty")}</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
