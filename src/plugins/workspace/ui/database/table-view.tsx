"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { DEFAULT_COLUMN, fitWidth, PROP_LABELS, PROP_TYPES, retype, type PropType, WIDTH_MIN, withWidths, columnOrder, groupRows, hasDependents, moveBefore, removeProperty, TITLE, dropBetween, type View } from "../../model";
import { Cell, type CellCtx } from "../cells";
import { useProgressive } from "../progressive";
import { Dropdown, MenuItem, useSortable } from "../kit";
import { CalcCell, usePublished } from "../calc-row";
import { type ViewProps, type Selection, SELECT_COLUMN, ADD_COLUMN } from "./shared";
import { RowMenu, TitleCell } from "./row-menu";

export function TableView({ view, rows, visible, schema, ctx, api, labels, openRow, setView, onSchema, justAdded, onEdited, sel, fill = false, onForm }: ViewProps & { /** The entry form opened with these cells (none set: a row is made). */ onForm?: (cells: Record<string, unknown>) => void; setView: (v: View) => void; onSchema: () => void; justAdded: number | null; onEdited: () => void; sel?: Selection; /** A database page of its own: the table as high as the window has room for. */ fill?: boolean }) {
  const t = useT();
  // As high as the window has room for (the line under it counted): the head on top, the sum row at the bottom, + New
  // right after the last row — an empty row between takes up the rest; more rows than room: it scrolls in itself.
  const box = useRef<HTMLDivElement>(null);
  const filler = useRef<HTMLTableRowElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!fill) return;
    const room = () => {
      const top = box.current?.getBoundingClientRect().top;
      // Below the fold (a phone: the page list above it): most of a screen.
      if (top !== undefined) setHeight(Math.max(240, Math.round(top > window.innerHeight * 0.6 ? window.innerHeight - 140 : window.innerHeight - top - 40)));
    };
    room();
    window.addEventListener("resize", room);
    return () => window.removeEventListener("resize", room);
  }, [fill]);
  useLayoutEffect(() => {
    const el = box.current;
    const table = el?.querySelector("table");
    const f = filler.current;
    if (!fill || !el || !table || !f) return;
    const size = () => {
      const rest = el.clientHeight - (table.offsetHeight - f.offsetHeight);
      f.style.height = `${Math.max(0, rest)}px`;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    ro.observe(table);
    return () => ro.disconnect();
  });
  const groups = view.groupBy ? groupRows(rows, view.groupBy, schema.properties, labels).filter((g) => !view.hideEmpty || g.rows.length) : [{ key: "", label: "", color: undefined as string | undefined, rows }];
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // Drawn in steps (a table of 1,200 rows): the first rows at once, more as you scroll — each group starts where the ones before it
  // ended; the sums, counts and "select all" go by every row.
  const open = groups.map((g) => (folded.has(g.key) ? 0 : g.rows.length));
  const starts = open.map((_, i) => open.slice(0, i).reduce((a, b) => a + b, 0));
  const { limit: drawn, more: undrawn, marker: drawMore } = useProgressive(open.reduce((a, b) => a + b, 0));
  // The columns in the view's order - the title is one of them and may sit anywhere (drag a header to move it).
  // (Grouped by a field: not its column too — the groups' headings say it.)
  const cols = columnOrder(view, schema).filter((id) => id === TITLE || (id !== view.groupBy && visible.some((p) => p.id === id)));
  const byId = new Map(visible.map((p) => [p.id, p]));
  const sort = useSortable((from, to, after) => setView({ ...view, order: moveBefore(columnOrder(view, schema), from, to, after) }), "x", "text/ws-col");
  // Rows in an order of your own: dragged by their handle — while the view isn't sorted by a field (then the sort decides, as on the board).
  const byHand = !view.sorts.length && ctx.editable;
  const rowSort = useSortable(
    (from, to, after) => {
      const at = dropBetween(rows.map((r) => r.id), Number(from), Number(to), after);
      if (at) api.place(Number(from), at.after, at.before);
    },
    "y",
    "text/ws-row",
  );
  // Hidden rows (shown because the view shows them too): set back.
  const hiddenIds = new Set(schema.hiddenRows ?? []);
  // A formula cell open: its column's formula changed from there; the columns it names coloured meanwhile.
  const [refs, setRefs] = useState<{ rowId: number; colors: Record<string, string> } | null>(null);
  const cellCtx: CellCtx = { ...ctx, showRefs: setRefs, setFormula: (id, formula) => api.changeSchema((s) => ({ ...s, properties: s.properties.map((q) => (q.id === id ? { ...q, formula } : q)) })) };
  // Only the cell it reads: the named column's in the formula's own row.
  const tint = (rowId: number, id: string): React.CSSProperties | undefined => {
    const c = refs?.rowId === rowId ? refs.colors[(id === TITLE ? schema.titleName : (byId.get(id)?.name ?? "")).toLowerCase()] : undefined;
    return c ? { background: `${c}1a`, boxShadow: `inset 0 0 0 2px ${c}` } : undefined;
  };
  // A column's content type from its header; a formula needs its expression: the properties open for that.
  const retypeColumn = (id: string, type: PropType) => {
    api.changeSchema((s) => ({ ...s, properties: s.properties.map((q) => (q.id === id ? retype(q, type) : q)) }));
    if (type === "formula") onSchema();
  };
  // Column widths: a drag on the head's right edge (live while dragging, kept with the view), a double-click or the menu fits one to its content.
  const tableRef = useRef<HTMLTableElement>(null);
  const [live, setLive] = useState<Record<string, number> | null>(null);
  // Widths never set: each column fitted to its content when it is first shown (not kept with the view).
  const [auto, setAuto] = useState<{ key: string; widths: Record<string, number> } | null>(null);
  const colsKey = cols.join(",");
  const widths = live ?? view.widths ?? (auto?.key === colsKey ? auto.widths : null);
  const fixed = !!widths && Object.keys(widths).length > 0;
  // The room there is: the columns share what is wider than their widths (the + column stays narrow).
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // The room the page gives (the box itself ends with its table).
    const host = el.parentElement ?? el;
    const ro = new ResizeObserver(() => setRoom(host.clientWidth - 2));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const sum = fixed ? cols.reduce((n, id) => n + (widths![id] ?? DEFAULT_COLUMN), 0) : 0;
  const free = room - SELECT_COLUMN - ADD_COLUMN;
  // At most half as wide again (an ultra-wide screen: the table ends, the rest stays free — no stretched columns).
  const GROW_MAX = 1.5;
  const grow = fixed && sum > 0 ? Math.min(GROW_MAX, Math.max(1, free / sum)) : 1;
  // Rounded down — what that leaves to the last column, so the table ends where the box does.
  const rest = grow > 1 && grow < GROW_MAX ? free - cols.reduce((n, id) => n + Math.floor((widths![id] ?? DEFAULT_COLUMN) * grow), 0) : 0;
  const shownWidth = (id: string) => Math.floor((widths![id] ?? DEFAULT_COLUMN) * grow) + (id === cols[cols.length - 1] ? rest : 0);
  /** Every column's width as it is laid out now (so fixing one doesn't make the others jump). */
  const measure = (): Record<string, number> => {
    const out: Record<string, number> = {};
    tableRef.current?.querySelectorAll<HTMLElement>("thead th[data-col]").forEach((th) => {
      out[th.dataset.col!] = th.getBoundingClientRect().width;
    });
    return out;
  };
  const startResize = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
    if (th) th.draggable = false; // the head is draggable to move the column
    const base = { ...measure(), ...(view.widths ?? {}) };
    const x0 = e.clientX;
    const w0 = measure()[id] ?? base[id] ?? DEFAULT_COLUMN;
    let cur: Record<string, number> | null = null;
    const move = (ev: PointerEvent) => {
      cur = { ...measure(), ...(view.widths ?? {}), [id]: Math.max(WIDTH_MIN, w0 + ev.clientX - x0) };
      setLive(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (th) th.draggable = true;
      setLive(null);
      if (cur) setView(withWidths(view, cur));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /** Columns fitted to their widest content (the head counts too) — kept with the view. */
  const fit = (ids: string[]) => {
    const next = fitted(ids);
    if (next) setView(withWidths(view, { ...measure(), ...(view.widths ?? {}), ...next }));
  };
  /** The widths the columns' content wants. */
  const fitted = (ids: string[]): Record<string, number> | null => {
    const table = tableRef.current;
    if (!table) return null;
    const next: Record<string, number> = {};
    const natural = (el: HTMLElement | null): number => {
      if (!el) return 0;
      const was = [el.style.width, el.style.maxWidth, el.style.flex];
      el.style.width = "max-content";
      el.style.maxWidth = "none";
      el.style.flex = "none";
      const w = el.getBoundingClientRect().width;
      [el.style.width, el.style.maxWidth, el.style.flex] = was;
      return w;
    };
    for (const id of ids) {
      const th = [...table.querySelectorAll<HTMLElement>("thead th[data-col]")].find((x) => x.dataset.col === id);
      if (!th) continue;
      const at = [...(th.parentElement?.children ?? [])].indexOf(th);
      let content = 0;
      table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) => {
        const td = tr.children[at] as HTMLTableCellElement | undefined;
        if (td && td.colSpan === 1) content = Math.max(content, natural(td.firstElementChild as HTMLElement | null));
      });
      next[id] = fitWidth(content, natural(th.firstElementChild as HTMLElement | null) + 24);
    }
    return next;
  };
  useLayoutEffect(() => {
    if (view.widths || auto?.key === colsKey) return;
    const next = fitted(cols);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured from the cells as laid out (once per set of columns)
    if (next) setAuto({ key: colsKey, widths: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitted/cols follow colsKey
  }, [view.widths, colsKey, auto?.key]);
  // The sum row: the values published from this database (their columns marked), the names to pick from.
  const published = usePublished(ctx.data.id);
  const numeric = visible.some((p) => p.type === "number" || p.type === "formula" || p.type === "rollup");
  const handle = (id: string) => (
    <span role="separator" aria-orientation="vertical" className="ws-resize" title={t("Drag to resize — double-click to fit")} onPointerDown={(e) => startResize(e, id)} onDoubleClick={(e) => (e.stopPropagation(), fit([id]))} onClick={(e) => e.stopPropagation()} />
  );
  const header = (
    <thead>
      <tr>
        <th className="ws-select w-18">
          {sel && rows.length > 0 && (
            <span className="flex items-center justify-center">
              <input type="checkbox" className="size-4 accent-indigo-600" checked={rows.every((r) => sel.has(r.id))} ref={(el) => void (el && (el.indeterminate = sel.any && !rows.every((r) => sel.has(r.id))))} onChange={() => sel.all(rows.map((r) => r.id))} aria-label={t("Select all rows")} />
            </span>
          )}
        </th>
        {cols.map((id) => {
          const p = byId.get(id);
          const drag = { ...sort.handle(id), ...sort.target(id) };
          if (!p)
            return (
              <th key={id} data-col={id} className={`${fixed ? "" : "min-w-56"} cursor-grab ${sort.mark(id)}`} title={t("Drag to move the column")} {...drag}>
                <span>{schema.titleName}</span>
                {handle(id)}
              </th>
            );
          return (
          <th key={p.id} data-col={p.id} className={`cursor-grab ${sort.mark(p.id)}`} title={t("Drag to move the column")} {...drag}>
            <Dropdown label={<span>{p.name}</span>} className="flex items-center gap-1 text-left">
              {(close) => (
                <>
                  <MenuItem onClick={() => (close(), setView({ ...view, sorts: [{ prop: p.id, dir: "asc" }] }))}>↑ {t("Sort ascending")}</MenuItem>
                  <MenuItem onClick={() => (close(), setView({ ...view, sorts: [{ prop: p.id, dir: "desc" }] }))}>↓ {t("Sort descending")}</MenuItem>
                  <MenuItem onClick={() => (close(), setView({ ...view, hidden: [...view.hidden, p.id] }))}>🙈 {t("Hide")}</MenuItem>
                  <div className="px-3 pt-1 text-xs text-zinc-500">{t("Content type")}</div>
                  {PROP_TYPES.filter((x) => x !== "relation" && x !== "rollup" && x !== "custom").map((x) => (
                    <MenuItem key={x} onClick={() => (close(), x !== p.type && retypeColumn(p.id, x))}>
                      {x === p.type ? "✓" : " "} {t(PROP_LABELS[x])}
                    </MenuItem>
                  ))}
                  {(ctx.data.extras?.fieldTypes ?? []).map((f) => (
                    <MenuItem key={f.id} onClick={() => (close(), api.changeSchema((s) => ({ ...s, properties: s.properties.map((q) => (q.id === p.id ? { ...retype(q, "custom"), custom: f.id } : q)) })))}>
                      {p.type === "custom" && p.custom === f.id ? "✓" : " "} {f.icon} {f.label}
                    </MenuItem>
                  ))}
                  <MenuItem onClick={() => (close(), fit([p.id]))}>↔ {t("Fit column to content")}</MenuItem>
                  <MenuItem onClick={() => (close(), fit(cols))}>↔ {t("Fit all columns")}</MenuItem>
                  {view.widths && <MenuItem onClick={() => (close(), setView(withWidths(view, null)))}>⟲ {t("Reset column widths")}</MenuItem>}
                  <MenuItem onClick={() => (close(), onSchema())}>⚙ {t("Edit properties …")}</MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      const note = hasDependents(schema, p.id) ? ` ${t("Other properties use this one (a rollup or a relation's other side).")}` : "";
                      if (!confirmAction(`${t("Delete the property “{name}” and its values?", { name: p.name })}${note}`)) return;
                      api.changeSchema((s) => removeProperty(s, p.id));
                    }}
                  >
                    🗑 {t("Delete the property")}
                  </MenuItem>
                </>
              )}
            </Dropdown>
            {handle(p.id)}
          </th>
          );
        })}
        <th className="ws-add-col align-middle" style={{ width: ADD_COLUMN }}>
          <span className="flex justify-center">
            <button type="button" className="grid size-6 place-items-center rounded-md border border-dashed border-zinc-300 text-sm leading-none text-zinc-400 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:border-indigo-400 focus-visible:text-indigo-600 dark:border-zinc-700 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300" onClick={onSchema} aria-label={t("Add a property")} title={t("Add a property")}>
              +
            </button>
          </span>
        </th>
      </tr>
    </thead>
  );
  return (
    <div ref={box} className={`${fill ? "overflow-auto" : "overflow-x-auto"} w-fit max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800`} style={fill && height ? { height } : undefined}>
      <table ref={tableRef} className={`ws-table${fixed ? " ws-fixed" : ""}${fill ? " ws-fill" : ""}`} style={fixed ? { tableLayout: "fixed", width: SELECT_COLUMN + ADD_COLUMN + cols.reduce((n, id) => n + shownWidth(id), 0) } : undefined}>
        {fixed && (
          <colgroup>
            {/* The row's checkbox and menu: as wide as they are (not squashed when the widths are fixed). */}
            <col style={{ width: SELECT_COLUMN }} />
            {cols.map((id) => (
              <col key={id} style={{ width: shownWidth(id) }} />
            ))}
            {/* The + column: as wide as its button. */}
            <col style={{ width: ADD_COLUMN }} />
          </colgroup>
        )}
        {header}
        {groups.map((g) => (
          <tbody key={g.key || "all"}>
            {view.groupBy && (
              <tr>
                <td colSpan={visible.length + 3} className="ws-group-row bg-zinc-50 dark:bg-zinc-900/50">
                  <button type="button" className="inline-flex items-center gap-2 align-middle text-sm" onClick={() => setFolded((f) => (f.has(g.key) ? new Set([...f].filter((x) => x !== g.key)) : new Set([...f, g.key])))} aria-expanded={!folded.has(g.key)}>
                    <span>{folded.has(g.key) ? "▸" : "▾"}</span>
                    {g.color ? <span className="ws-tag" data-color={g.color}>{g.label}</span> : <span className="font-medium">{g.key ? g.label : t("No value")}</span>}
                    <span className="text-zinc-400">{g.rows.length}</span>
                  </button>
                  {/* A row in this group: its field set to the group's value (the blue "New" above adds one without). */}
                  {!ctx.data.noNewRows && (
                    <button
                      type="button"
                      className="ml-2 inline-grid size-5 place-items-center rounded align-middle text-sm leading-none text-zinc-400 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:bg-indigo-50 focus-visible:text-indigo-700 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300"
                      title={t("New row in “{group}”", { group: g.key ? g.label : t("No value") })}
                      aria-label={t("New row in “{group}”", { group: g.key ? g.label : t("No value") })}
                      onClick={() => {
                        const gp = schema.properties.find((p) => p.id === view.groupBy);
                        const cells = gp && g.key ? { [gp.id]: gp.type === "multi_select" || gp.type === "person" || gp.type === "relation" ? [gp.type === "multi_select" ? g.key : Number(g.key)] : gp.type === "checkbox" ? g.key === "true" : g.key } : {};
                        if (onForm) onForm(cells);
                        else void api.addRow(cells);
                      }}
                    >
                      +
                    </button>
                  )}
                </td>
              </tr>
            )}
            {!folded.has(g.key) &&
              g.rows.slice(0, Math.max(0, drawn - starts[groups.indexOf(g)])).map((r) => (
                <tr key={r.id} className={`group/row ${hiddenIds.has(r.id) ? "ws-row-hidden" : ""} ${byHand ? rowSort.mark(String(r.id)) : ""}`} {...(byHand ? rowSort.target(String(r.id)) : {})}>
                  <td className="ws-select w-18">
                    {/* Centred in the row (.ws-select: the table's other cells are aligned to the top, a tag makes a row taller). */}
                    <span className="flex items-center justify-center gap-1">
                      {byHand && (
                        <span className="cursor-grab px-0.5 text-zinc-400 opacity-0 group-hover/row:opacity-100 active:cursor-grabbing" title={t("Drag to move")} aria-hidden {...rowSort.handle(String(r.id))}>
                          ⠿
                        </span>
                      )}
                      {sel && <input type="checkbox" className={`size-4 accent-indigo-600 ${sel.has(r.id) || sel.any ? "" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"}`} checked={sel.has(r.id)} onChange={() => undefined} onClick={(e) => sel.toggle(r.id, e.shiftKey, rows.map((x) => x.id))} aria-label={t("Select {name}", { name: r.title || t("Untitled") })} />}
                      <span className="opacity-0 group-hover/row:opacity-100">
                        <RowMenu row={r} api={api} />
                      </span>
                    </span>
                  </td>
                  {cols.map((id) => {
                    const p = byId.get(id);
                    return p ? (
                      <td key={p.id} style={tint(r.id, p.id)}>
                        <Cell p={p} row={r} ctx={cellCtx} />
                      </td>
                    ) : (
                      <td key={id} style={tint(r.id, id)}>
                        <TitleCell row={r} ctx={ctx} openRow={openRow} autoEdit={justAdded === r.id} onEdited={onEdited} />
                      </td>
                    );
                  })}
                  <td className="ws-add-col" />
                </tr>
              ))}
            {/* (No "+ New" under the rows: the blue "New" above the table adds one.) */}
          </tbody>
        ))}
        {undrawn > 0 && (
          <tbody aria-hidden>
            <tr ref={drawMore}>
              <td colSpan={visible.length + 3} className="py-3 text-center text-xs text-zinc-400">
                …
              </td>
            </tr>
          </tbody>
        )}
        {fill && (
          <tbody aria-hidden>
            <tr ref={filler} className="ws-filler">
              <td colSpan={visible.length + 3} />
            </tr>
          </tbody>
        )}
        {numeric && rows.length > 0 && (
          <tfoot className="border-t border-zinc-200 dark:border-zinc-800">
            <tr>
              <td />
              {cols.map((id) => (
                <CalcCell key={id} p={byId.get(id)} view={view} rows={rows} dbId={ctx.data.id} setView={setView} published={published} />
              ))}
              <td className="ws-add-col" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
