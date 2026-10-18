"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { todoListSettingsAction } from "../actions";
import { dateRange, TITLE, todoColumns, type DbSchema, type Row } from "../model";

/**
 * A database as a todo list: a box before each row, the text, its date - grouped by what is due (overdue, today, later, no date), the done
 * ones folded below. A line at the top adds one. The switch "Todo engine" makes the open rows todos of the Todos tab too (and ticking them
 * there ticks them here).
 */

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Api = { set: (rowId: number, propId: string, value: unknown) => unknown; addRow: (cells?: Record<string, unknown>, title?: string) => unknown; reload: () => unknown };

export function TodoView({ dbId, rows, schema, api, openRow, locked, canAdd }: { dbId: number; rows: Row[]; schema: DbSchema; api: Api; openRow: (id: number) => void; locked: boolean; canAdd: boolean }) {
  const t = useT();
  const cols = todoColumns(schema);
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  if (!cols)
    return <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("A todo list needs a checkbox field that says done — add one in the properties.")}</p>;

  const today = day(new Date());
  const dueOf = (r: Row) => (cols.due ? (dateRange(r.cells[cols.due.id])?.start.slice(0, 10) ?? null) : null);
  const isDone = (r: Row) => r.cells[cols.done.id] === true;
  const open = rows.filter((r) => !isDone(r));
  const done = rows.filter(isDone);
  const groups: { key: string; label: string; tone?: string; rows: Row[] }[] = [
    { key: "overdue", label: t("Overdue"), tone: "text-red-600 dark:text-red-400", rows: open.filter((r) => (dueOf(r) ?? "9") < today) },
    { key: "today", label: t("Today"), rows: open.filter((r) => dueOf(r) === today) },
    { key: "later", label: t("Later"), rows: open.filter((r) => (dueOf(r) ?? "") > today) },
    { key: "none", label: cols.due ? t("No date") : "", rows: open.filter((r) => !dueOf(r)) },
  ].map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => (dueOf(a) ?? "9").localeCompare(dueOf(b) ?? "9")) }));

  const toggleEngine = async (on: boolean) => {
    const r = await todoListSettingsAction(dbId, { engine: on });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(on ? t("Its open rows are todos of the Todos tab now.") : t("It no longer feeds the Todos tab."), { tone: "ok" });
    await api.reload();
  };

  const line = (r: Row) => (
    <li key={r.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <input type="checkbox" className="size-4 accent-indigo-600" checked={isDone(r)} disabled={locked} onChange={(e) => void api.set(r.id, cols.done.id, e.target.checked)} aria-label={r.title || t("Untitled")} />
      <input
        className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${isDone(r) ? "line-through opacity-60" : ""}`}
        defaultValue={r.title}
        disabled={locked}
        placeholder={t("Untitled")}
        onBlur={(e) => e.target.value.trim() !== r.title && void api.set(r.id, TITLE, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={t("Todo")}
      />
      {cols.due && (
        <input
          type="date"
          className={`w-[8.5rem] bg-transparent text-xs outline-none ${!isDone(r) && (dueOf(r) ?? "9") < today ? "text-red-600" : "text-zinc-500"} ${dueOf(r) ? "" : "opacity-0 group-hover:opacity-100"}`}
          value={dueOf(r) ?? ""}
          disabled={locked}
          onChange={(e) => void api.set(r.id, cols.due!.id, e.target.value || null)}
          aria-label={cols.due.name}
        />
      )}
      <button type="button" className="icon-btn opacity-0 group-hover:opacity-100" title={t("Open")} aria-label={t("Open")} onClick={() => openRow(r.id)}>
        ↗
      </button>
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {canAdd && !locked && (
          <input
            className="input min-w-48 flex-1"
            value={text}
            placeholder={t("+ Add a todo")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !text.trim()) return;
              const v = text.trim();
              setText("");
              void api.addRow({}, v);
            }}
            aria-label={t("Add a todo")}
          />
        )}
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={t("The open rows are todos of the Todos tab too — ticking one there ticks it here.")}>
          <input type="checkbox" className="size-4 accent-indigo-600" checked={cols.engine} disabled={locked} onChange={(e) => void toggleEngine(e.target.checked)} />
          {t("Todo engine")}
        </label>
        {cols.engine && (
          <Link href="/todos" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open the Todos tab")} →
          </Link>
        )}
        <span className="ml-auto text-xs text-zinc-500">{t("{done} of {n} done", { done: done.length, n: rows.length })}</span>
      </div>
      {groups.map(
        (g) =>
          g.rows.length > 0 && (
            <section key={g.key}>
              {g.label && <h4 className={`px-1.5 pb-0.5 text-xs font-semibold tracking-wide uppercase ${g.tone ?? "text-zinc-500"}`}>{g.label} · {g.rows.length}</h4>}
              <ul>{g.rows.map(line)}</ul>
            </section>
          ),
      )}
      {open.length === 0 && <p className="px-1.5 text-sm text-zinc-500">{rows.length ? t("Everything is done. 🎉") : t("Nothing here yet.")}</p>}
      {done.length > 0 && (
        <section>
          <button type="button" className="px-1.5 pb-0.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:underline" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? "▾" : "▸"} {t("Done")} · {done.length}
          </button>
          {showDone && <ul>{done.map(line)}</ul>}
        </section>
      )}
    </div>
  );
}
