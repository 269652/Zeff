"use client";

import { useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { addSubtaskAction, placeRowAction } from "../../actions";
import { dropValue, moveOption, moveOptionTo, removeOption, renameOption, setOptionDone, setWipLimit, type Group, groupRows, type DbSchema, type Property, type Row, type View } from "../../model";
import { RowCard } from "../cards";
import { Dropdown, MenuItem } from "../kit";
import type { ViewProps } from "./shared";
import { RowMenu } from "./row-menu";
import type { Api } from "./use-database";

export function BoardView({ view, rows, visible, schema, ctx, api, labels, openRow, newRow, onForm }: ViewProps & { newRow: (cells?: Record<string, unknown>, templateId?: number, open?: boolean) => Promise<void>; onForm?: (cells: Record<string, unknown>) => void }) {
  // A subtask (its parent named): no subtasks of its own.
  const parentProp = schema.properties.find((p) => p.type === "relation" && p.relationDb === ctx.data.id && !p.backOf);
  const isSubtask = (r: Row) => !!parentProp && (Array.isArray(r.cells[parentProp.id]) ? (r.cells[parentProp.id] as unknown[]).length > 0 : !!r.cells[parentProp.id]);
  const t = useT();
  const gp = schema.properties.find((p) => p.id === view.groupBy);
  // Where a dragged card would land: its column and the card it would go before (null: the end).
  const [over, setOver] = useState<{ key: string; before: number | null } | null>(null);
  // A column being dragged (its head) — and the column it would go in front of.
  const [colOver, setColOver] = useState<string | null>(null);
  if (!gp) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("Choose a property to group the board by (a status or a select).")}</p>;
  const groups = groupRows(rows, gp.id, schema.properties, labels);
  const valueFor = (key: string): unknown => (gp.type === "checkbox" ? key === "true" : key === "" ? null : gp.type === "multi_select" ? [key] : gp.type === "person" || gp.type === "relation" ? [Number(key)] : key);
  // A manual order only when the view isn't sorted (else the sort decides).
  const ordered = !view.sorts.length;
  /** The card the cursor is above (by its vertical middle) in a column: the one to land before. */
  const beforeAt = (col: HTMLElement, y: number): number | null => {
    for (const el of col.querySelectorAll<HTMLElement>("[data-row]")) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(el.dataset.row);
    }
    return null;
  };
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {groups.map((g) => (
        <div
          key={g.key || "none"}
          className={`ws-column w-72 shrink-0 space-y-2 rounded-xl p-2 ${over?.key === g.key ? "ws-column-over" : ""} ${colOver === g.key ? "ws-column-drop-before" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("text/ws-col")) return void (colOver !== g.key && setColOver(g.key));
            const before = beforeAt(e.currentTarget, e.clientY);
            if (over?.key !== g.key || over.before !== before) setOver({ key: g.key, before });
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && (setOver(null), setColOver(null))}
          onDrop={(e) => {
            e.preventDefault();
            setColOver(null);
            const col = e.dataTransfer.getData("text/ws-col");
            if (col) {
              // A column dropped on another: in front of it ("No value" stays last).
              if (!ctx.data.locked && gp.options?.some((o) => o.id === g.key)) api.changeSchema((s) => moveOptionTo(s, gp.id, col, g.key));
              return;
            }
            const before = beforeAt(e.currentTarget, e.clientY);
            setOver(null);
            if (ctx.data.locked) return;
            const id = Number(e.dataTransfer.getData("text/ws-row"));
            const from = e.dataTransfer.getData("text/ws-from");
            const row = rows.find((r) => r.id === id);
            if (!row) return;
            if (from !== g.key) api.set(id, gp.id, dropValue(gp, row.cells[gp.id], from, g.key));
            if (ordered && before !== id) {
              const list = g.rows.filter((r) => r.id !== id);
              const at = before === null ? list.length : list.findIndex((r) => r.id === before);
              api.place(id, list[at - 1]?.id ?? null, list[at]?.id ?? null);
            }
          }}
        >
          <ColumnHead g={g} gp={gp} view={view} rows={rows} api={api} locked={!!ctx.data.locked} />
          {g.rows.map((r) => (
            <div key={r.id} className="group/sub relative">
            <div
              data-row={r.id}
              data-attention={ctx.data.extras?.tickets[ctx.data.extras.keys[r.id] ?? ""]?.attention ?? undefined}
              className={`ws-card group/card relative cursor-pointer ${over?.key === g.key && over.before === r.id ? "ws-card-drop-before" : ""}`}
              draggable={!ctx.data.locked}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/ws-row", String(r.id));
                e.dataTransfer.setData("text/ws-from", g.key);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => openRow(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && openRow(r.id)}
            >
              <span className="absolute top-1 right-1 rounded bg-white/90 opacity-0 group-hover/card:opacity-100 dark:bg-zinc-900/90" onClick={(e) => e.stopPropagation()}>
                <RowMenu row={r} api={api} />
              </span>
              <RowCard row={r} visible={visible.filter((p) => p.id !== gp.id)} all={schema.properties} ctx={ctx} mode="board" template={view.card} />
            </div>
            {/* A subtask's shadow card under it on hover (not under a subtask: one level). */}
            {!ctx.data.locked && !isSubtask(r) && <SubtaskGhost parentId={r.id} after={() => void api.reload()} />}
            </div>
          ))}
          {over?.key === g.key && over.before === null && <div className="ws-drop-line" aria-hidden />}
          {!ctx.data.locked && !ctx.data.noNewRows && <NewCard cells={{ [gp.id]: valueFor(g.key) }} add={(cells, title) => api.addRow(cells, title)} onForm={onForm} />}
        </div>
      ))}
      {!ctx.data.locked && (gp.type === "status" || gp.type === "select" || gp.type === "multi_select") && <AddColumn add={(name) => void api.addOption(gp.id, name)} />}
    </div>
  );
}

/**
 * A board column's head, edited in place as Kanban's: its name (click to rename), "n" or "n/WIP" (red over the limit), ✓ when
 * it counts as done — and its menu: move left/right, counts as done, WIP limit, delete (only when empty).
 */
function ColumnHead({ g, gp, view, rows, api, locked }: { g: Group; gp: Property; view: View; rows: Row[]; api: Api; locked: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const option = locked ? undefined : gp.options?.find((o) => o.id === g.key);
  const shown = gp.options?.find((o) => o.id === g.key);
  const wip = shown ? view.wip?.[shown.id] : undefined;
  const over = wip !== undefined && g.rows.length > wip;
  const done = shown?.group === "done";
  const label = g.key ? g.label : t("No value");
  const change = (fn: (s: DbSchema) => DbSchema) => {
    try {
      api.changeSchema(fn);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    }
  };
  const i = gp.options?.findIndex((o) => o.id === g.key) ?? -1;
  return (
    <div
      className={`flex items-center gap-2 px-1 text-sm ${option ? "cursor-grab" : ""}`}
      draggable={!!option && !editing}
      onDragStart={(e) => {
        if (!option) return;
        e.stopPropagation();
        e.dataTransfer.setData("text/ws-col", option.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={option ? t("Drag to move the column") : undefined}
    >
      {option && editing ? (
        <input
          autoFocus
          defaultValue={option.name}
          aria-label={t("Column …")}
          className="input min-w-0 flex-1 py-0.5 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value;
            setEditing(false);
            if (name.trim() && name.trim() !== option.name) change((s) => renameOption(s, gp.id, option.id, name));
          }}
        />
      ) : option ? (
        <button type="button" onClick={() => setEditing(true)} className="ws-tag cursor-text" data-color={g.color} title={t("Column …")}>
          {label}
        </button>
      ) : shown ? (
        <span className="ws-tag" data-color={g.color}>
          {label}
        </span>
      ) : (
        <span className="font-medium text-zinc-500">{label}</span>
      )}
      {done && <span className="text-emerald-600" aria-hidden>✓</span>}
      <span className={over ? "font-semibold text-red-600" : "text-zinc-400"}>{wip !== undefined ? `${g.rows.length}/${wip}` : g.rows.length}</span>
      {option && (
        <span className="ml-auto">
          <Dropdown label="✎" title={t("Column menu")} align="right" className="rounded px-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700">
            {(close) => (
              <>
                <MenuItem disabled={i <= 0} onClick={() => (change((s) => moveOption(s, gp.id, option.id, -1)), close())}>
                  {t("← move left")}
                </MenuItem>
                <MenuItem disabled={i < 0 || i >= (gp.options?.length ?? 0) - 1} onClick={() => (change((s) => moveOption(s, gp.id, option.id, 1)), close())}>
                  {t("move right →")}
                </MenuItem>
                {gp.type === "status" && (
                  <MenuItem onClick={() => (change((s) => setOptionDone(s, gp.id, option.id, !done)), close())}>{done ? t("No longer counts as done") : t("Counts as done ✓")}</MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    close();
                    const v = prompt(t("WIP limit (empty: none)"), wip ? String(wip) : "");
                    if (v !== null) change((s) => setWipLimit(s, view.id, option.id, v.trim() ? Number(v) : null));
                  }}
                >
                  {t("WIP limit …")}
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    // Its cards would lose their place: only an empty column goes (all rows, not just the filtered ones).
                    const n = (api.data?.rows ?? rows).filter((r) => [r.cells[gp.id]].flat().includes(option.id)).length;
                    if (n) return void toast(n === 1 ? t("The column still has 1 card — move it first.") : t("The column still has {n} cards — move them first.", { n }), { tone: "error" });
                    if (confirmAction(t("Delete the column “{name}”?", { name: option.name }))) change((s) => removeOption(s, gp.id, option.id, api.data?.rows ?? rows));
                  }}
                >
                  {t("Delete column")}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </span>
      )}
    </div>
  );
}

/** "+ Column" at the end of a board: a new option of the property it groups by. */
function AddColumn({ add }: { add: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  return (
    <div className="w-72 shrink-0 rounded-xl border-2 border-dashed border-zinc-200 p-2 dark:border-zinc-800">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            add(name.trim());
            setName("");
          }
        }}
        placeholder={t("+ Column")}
        aria-label={t("New column")}
        className="w-full bg-transparent px-1 py-1 text-sm outline-none"
      />
    </div>
  );
}

/**
 * "+ New" at the end of a board column, as Kanban's "+ Card": a field for the title — Enter makes the card (in this column)
 * and keeps the field open for the next one, Shift+Enter a new line, Escape or leaving it empty closes it.
 */
/** Under a card on hover: a shadow card — a click, a title, Enter: a subtask of it (in its column, right below it). A corner tab fitted into the card's bottom right (it takes no room and covers no other card; the text field it opens does). */
function SubtaskGhost({ parentId, after }: { parentId: number; after: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="absolute right-px bottom-px z-10 hidden rounded-tl-md rounded-br-[0.5rem] border-t border-l border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 group-hover/sub:block hover:bg-indigo-50 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
        onClick={() => setOpen(true)}
        data-subtask-ghost={parentId}
      >
        + {t("Subtask")}
      </button>
    );
  const save = async () => {
    const title = text.trim();
    if (!title) return setOpen(false);
    setBusy(true);
    const r = await addSubtaskAction(parentId, title);
    if (r.ok) await placeRowAction(r.id, parentId, null);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText("");
    after();
  };
  return (
    <textarea
      autoFocus
      rows={1}
      value={text}
      readOnly={busy}
      className="input mt-1 w-full border-dashed text-sm"
      placeholder={t("Subtask")}
      aria-label={t("New subtask")}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
      onBlur={() => !text.trim() && setOpen(false)}
    />
  );
}

function NewCard({ cells, add, onForm }: { cells: Record<string, unknown>; add: (cells: Record<string, unknown>, title: string) => Promise<number | null>; /** The entry form, opened with the column's value (instead of a title typed here). */ onForm?: (cells: Record<string, unknown>) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  if (!open)
    return (
      <button type="button" className="w-full rounded-md px-2 py-1 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => (onForm ? onForm(cells) : setOpen(true))}>
        + {t("New")}
      </button>
    );
  const save = async () => {
    const title = text.trim();
    if (!title) return setOpen(false);
    setBusy(true);
    const id = await add(cells, title);
    setBusy(false);
    if (id) setText("");
    field.current?.focus(); // the next one right away
  };
  return (
    <textarea
      ref={field}
      autoFocus
      rows={2}
      value={text}
      readOnly={busy}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
      onBlur={() => !text.trim() && setOpen(false)}
      placeholder={t("Title")}
      aria-label={t("New card")}
      className="ws-card w-full resize-none text-sm outline-none"
    />
  );
}
