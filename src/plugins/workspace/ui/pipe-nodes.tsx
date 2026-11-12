"use client";

import type { Editor, JSONContent } from "@tiptap/react";
import {
  mergeAttributes,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  pipeDatabaseAction,
  pipeDescribeAction,
  pipeSourcesAction,
  pipeStepsFromTextAction,
} from "../actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { T } from "@/lib/i18n/shared";
import {
  asGrid,
  AGGS,
  applyStep,
  CMPS,
  evaluatePipes,
  gridOfCells,
  normalizeSteps,
  numOf,
  outcomeFor,
  plainDescription,
  OPS,
  stepsFromText,
  stepsToText,
  type Agg,
  type Cell,
  type Cmp,
  type Grid,
  type Outcome,
  type PageGrid,
  type PipeDef,
  type PipeExample,
  type PipeStep,
} from "../table-pipe";
import { GripBar } from "./app-nodes";
import { Inline } from "./inline-edit";
import { Dropdown, MenuItem, MenuSection } from "./kit";
import { pageTables } from "./table-formulas";

/**
 * Tables that are transformed on a page: a "transform" block (tablePipe) reads a table of the page (by its name — ⋯ menu of a
 * table), another transform or a database, applies steps (filter, sort, group …) and keeps them; a "result table" (pipeResult)
 * shows what comes out, anywhere on the page. Set up with the choices in the block, or by a sentence the AI turns into steps.
 */

// ---------------------------------------------------------------------------
// The page as the blocks see it
// ---------------------------------------------------------------------------

/** What a block reads when it takes the output of the block above it (a pipeline). */
const ABOVE = "@above";
type Db = { id: number; title: string };
const dbCache = new Map<number, Grid | "loading" | "gone">();
const dbListeners = new Set<() => void>();
let dbList: Db[] | null = null;
let dbListAsked = false;
const tell = () => dbListeners.forEach((f) => f());

function wantDb(id: number) {
  if (dbCache.has(id)) return;
  dbCache.set(id, "loading");
  void pipeDatabaseAction(id).then((r) => {
    dbCache.set(id, r.ok ? r.grid : "gone");
    tell();
  });
}

export type Page = {
  tables: (PageGrid & { pos: number })[];
  pipes: PipeDef[];
  outcomes: Map<string, Outcome>;
  external: Record<string, Grid>;
  dbs: Db[];
  /** The result tables (the calculated ones): where they stand, the title that names them (none yet: ""), what they show. */
  results: { pos: number; title: string; of: string }[];
  /** For a block that reads "the block above" (by where it stands in the document): the name of the one it found. */
  aboveOf: Map<number, string>;
};

/** The page's tables, transforms and databases, worked out again whenever the page changes. */
export function usePage(editor: Editor): Page {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on("update", bump);
    dbListeners.add(bump);
    if (!dbListAsked) {
      dbListAsked = true;
      void pipeSourcesAction().then((r) => {
        dbList = r.ok ? r.databases : [];
        tell();
      });
    }
    return () => {
      editor.off("update", bump);
      dbListeners.delete(bump);
    };
  }, [editor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the page changing (the editor's document is not a React value)
  return useMemo(() => collect(editor), [editor, tick]);
}

function collect(editor: Editor): Page {
  const doc = editor.state.doc;
  const tables = pageTables(doc).map((t) => ({
    name: t.name,
    pos: t.pos,
    grid: gridOfCells(t.rows),
  }));
  const pipes: PipeDef[] = [];
  const refs = new Set<string>();
  const aboveOf = new Map<number, string>();
  const results: Page["results"] = [];
  const tableNames = new Map(tables.map((x) => [x.pos, x.name.trim()]));
  // (What stands above a block that reads "the block above": the nearest named table or transform before it.)
  let last = "";
  doc.descendants((n, pos) => {
    if (n.type.name === "table") {
      if (tableNames.get(pos)) last = tableNames.get(pos)!;
      return false;
    }
    if (n.type.name === "tablePipe") {
      const raw = String(n.attrs.from ?? "");
      const from = raw === ABOVE ? last : raw;
      if (raw === ABOVE) aboveOf.set(pos, last);
      const name = String(n.attrs.name ?? "");
      pipes.push({ name, from, steps: stepsFromText(n.attrs.steps) });
      refs.add(from);
      if (name.trim()) last = name.trim();
      return false;
    }
    if (n.type.name === "codeCell") {
      // (A cell with a name hands its output on: a table it returned is read like any table of the page.)
      const name = String(n.attrs.name ?? "").trim();
      let g: Grid | null = null;
      try {
        g = name && n.attrs.result ? asGrid(JSON.parse(String(n.attrs.result)) as unknown) : null;
      } catch {
        g = null;
      }
      if (g && !tables.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) tables.push({ name, pos, grid: g });
      if (name) last = name;
      return false;
    }
    if (n.type.name === "pipeResult") {
      const raw = String(n.attrs.of ?? "");
      if (raw === ABOVE) aboveOf.set(pos, last);
      refs.add(raw === ABOVE ? last : raw);
      results.push({ pos, title: String(n.attrs.title ?? ""), of: raw === ABOVE ? last : raw });
      return false;
    }
    return true;
  });
  const external: Record<string, Grid> = {};
  for (const r of refs) {
    const m = /^db:(\d+)$/.exec(r.trim());
    if (!m) continue;
    const g = dbCache.get(Number(m[1]));
    if (g === undefined) wantDb(Number(m[1]));
    else if (g !== "loading" && g !== "gone")
      external[r.trim().toLowerCase()] = g;
  }
  return {
    tables,
    pipes,
    outcomes: evaluatePipes(tables, pipes, external),
    external,
    dbs: dbList ?? [],
    aboveOf,
    results,
  };
}

/** An unnamed table gets a name (the transform needs one to read it by). */
function nameTable(editor: Editor, pos: number, name: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "table") return;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, name }),
  );
}

/** A table of the page named (so a block can read it by name); the name it got. */
export function giveName(editor: Editor, page: Page, pos: number, tableWord: string): string {
  const n = page.tables.findIndex((x) => x.pos === pos) + 1;
  let name = `${tableWord} ${n}`;
  while (page.tables.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) name += "*";
  nameTable(editor, pos, name);
  return name;
}

/** Where a block can read from: the page's named tables, its other transforms, the databases. */
function SourceSelect({
  page,
  editor,
  value,
  exclude,
  onChange,
  label,
}: {
  page: Page;
  editor: Editor;
  value: string;
  exclude?: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const t = useT();
  const named = page.tables.filter((x) => x.name.trim());
  const unnamed = page.tables.filter((x) => !x.name.trim());
  const pipes = page.pipes.filter(
    (p) =>
      p.name.trim() &&
      p.name.trim().toLowerCase() !== (exclude ?? "").trim().toLowerCase(),
  );
  const known =
    !value ||
    value === ABOVE ||
    named.some((x) => x.name === value) ||
    pipes.some((p) => p.name === value) ||
    /^db:\d+$/.test(value);
  return (
    <select
      className="input w-auto max-w-56 py-0.5 text-xs"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v.startsWith("@table:") ? giveName(editor, page, Number(v.slice(7)), t("Table")) : v);
      }}
    >
      <option value="">{t("Pick …")}</option>
      <option value={ABOVE}>{t("↑ The block above (pipeline)")}</option>
      {!known && <option value={value}>{value}</option>}
      {named.length > 0 && (
        <optgroup label={t("Tables on this page")}>
          {named.map((x) => (
            <option key={x.pos} value={x.name}>
              {x.name}
            </option>
          ))}
        </optgroup>
      )}
      {unnamed.length > 0 && (
        <optgroup label={t("Tables without a name (gets one)")}>
          {unnamed.map((x) => (
            <option key={x.pos} value={`@table:${x.pos}`}>
              {`${t("Table")} ${page.tables.findIndex((y) => y.pos === x.pos) + 1}`}
            </option>
          ))}
        </optgroup>
      )}
      {pipes.length > 0 && (
        <optgroup label={t("Results of transforms")}>
          {pipes.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {page.dbs.length > 0 && (
        <optgroup label={t("Databases")}>
          {page.dbs.map((d) => (
            <option key={d.id} value={`db:${d.id}`}>
              {d.title}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const OP_LABEL = (t: T): Record<(typeof OPS)[number], string> => ({
  filter: t("Keep only rows where …"),
  sort: t("Sort by …"),
  group: t("Group and total …"),
  add: t("New column from a formula"),
  pick: t("Only these columns"),
  rename: t("Rename a column"),
  unique: t("Remove doubles"),
  limit: t("Only the first …"),
});
const CMP_LABEL = (t: T): Record<Cmp, string> => ({
  "=": t("is"),
  "!=": t("is not"),
  ">": ">",
  "<": "<",
  ">=": "≥",
  "<=": "≤",
  contains: t("contains"),
  not_contains: t("does not contain"),
  starts: t("starts with"),
  empty: t("is empty"),
  not_empty: t("is not empty"),
});
const AGG_LABEL = (t: T): Record<Agg, string> => ({
  sum: t("Sum"),
  count: t("Count"),
  avg: t("Average"),
  min: t("Smallest"),
  max: t("Largest"),
});

function newStep(op: (typeof OPS)[number], cols: string[]): PipeStep {
  const c = cols[0] ?? "";
  switch (op) {
    case "filter":
      return { op, col: c, cmp: "=", value: "" };
    case "sort":
      return { op, col: c, dir: "asc" };
    case "group":
      return { op, by: c, agg: "count" };
    case "add":
      return { op, name: "", formula: "" };
    case "pick":
      return { op, cols: cols.slice(0, 3) };
    case "rename":
      return { op, col: c, to: "" };
    case "unique":
      return { op };
    case "limit":
      return { op, n: 10 };
  }
}

/** A text field that commits when it is left (so a typed formula is one change, not one per key). */
function Txt({ value, onCommit, placeholder, className, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; label: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
      placeholder={placeholder}
      aria-label={label}
      className={`input ws-pipe-field ${className ?? "w-28"}`}
    />
  );
}

function ColSelect({ cols, value, onChange, label, none }: { cols: string[]; value: string; onChange: (v: string) => void; label: string; none?: string }) {
  const known = !value || cols.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <select className="input ws-pipe-field max-w-40" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {none !== undefined && <option value="">{none}</option>}
      {!known && <option value={value}>{`⚠ ${value}`}</option>}
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

const ICON_BTN = "flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-200";

/** One step: its number, what it is, its choices, and (when editing) earlier / later / remove — in columns that line up from step to step. */
function StepRow({ n, step, cols, edit, onChange, onMove, onRemove, error }: { n: number; step: PipeStep; cols: string[]; edit: boolean; onChange: (s: PipeStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; error?: boolean }) {
  const t = useT();
  const cmp = CMP_LABEL(t);
  const col = (value: string, set: (v: string) => void, label: string, none?: string) => <ColSelect cols={cols} value={value} onChange={set} label={label} none={none} />;
  const word = (s: string) => <span className="px-0.5 text-xs text-zinc-400">{s}</span>;
  return (
    <li className={`grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border px-2 py-1.5 ${error ? "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20" : "border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-900/40"}`}>
      <span className="text-center text-[11px] font-semibold tabular-nums text-zinc-400">{n}</span>
      <span className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-300" title={OP_LABEL(t)[step.op]}>
        {OP_LABEL(t)[step.op].replace(/ …$/, "")}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {step.op === "filter" && (
          <>
            {col(step.col, (v) => onChange({ ...step, col: v }), t("Column"))}
            <select className="input ws-pipe-field" aria-label={t("Comparison")} value={step.cmp} onChange={(e) => onChange({ ...step, cmp: e.target.value as Cmp })}>
              {CMPS.map((c) => (
                <option key={c} value={c}>
                  {cmp[c]}
                </option>
              ))}
            </select>
            {step.cmp !== "empty" && step.cmp !== "not_empty" && <Txt key={step.value ?? ""} value={step.value ?? ""} onCommit={(v) => onChange({ ...step, value: v })} label={t("Value")} placeholder={t("Value")} />}
          </>
        )}
        {step.op === "sort" && (
          <>
            {col(step.col, (v) => onChange({ ...step, col: v }), t("Column"))}
            <select className="input ws-pipe-field" aria-label={t("Direction")} value={step.dir} onChange={(e) => onChange({ ...step, dir: e.target.value === "desc" ? "desc" : "asc" })}>
              <option value="asc">{t("A → Z, small first")}</option>
              <option value="desc">{t("Z → A, big first")}</option>
            </select>
          </>
        )}
        {step.op === "group" && (
          <>
            {word(t("by"))}
            {col(step.by, (v) => onChange({ ...step, by: v }), t("Group by"))}
            <select className="input ws-pipe-field" aria-label={t("Calculation")} value={step.agg} onChange={(e) => onChange({ ...step, agg: e.target.value as Agg })}>
              {AGGS.map((a) => (
                <option key={a} value={a}>
                  {AGG_LABEL(t)[a]}
                </option>
              ))}
            </select>
            {step.agg !== "count" && (
              <>
                {word(t("of"))}
                {col(step.col ?? "", (v) => onChange({ ...step, col: v }), t("Column"), t("Pick …"))}
              </>
            )}
            {word("→")}
            <Txt key={step.as ?? ""} value={step.as ?? ""} onCommit={(v) => onChange({ ...step, as: v })} label={t("Name of the new column")} placeholder={t("Name of the new column")} />
          </>
        )}
        {step.op === "add" && (
          <>
            <Txt key={step.name} value={step.name} onCommit={(v) => onChange({ ...step, name: v })} label={t("Name of the new column")} placeholder={t("Name of the new column")} />
            {word("=")}
            <Txt key={step.formula} value={step.formula} onCommit={(v) => onChange({ ...step, formula: v })} label={t("Formula")} placeholder="[Betrag] * 1,19" className="w-48 font-mono" />
          </>
        )}
        {step.op === "pick" &&
          cols.map((c) => {
            const on = step.cols.some((x) => x.toLowerCase() === c.toLowerCase());
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                className={`h-6 rounded-full border px-2.5 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200" : "border-zinc-300 text-zinc-500 dark:border-zinc-600"}`}
                onClick={() => onChange({ ...step, cols: on ? step.cols.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...step.cols, c] })}
              >
                {c}
              </button>
            );
          })}
        {step.op === "rename" && (
          <>
            {col(step.col, (v) => onChange({ ...step, col: v }), t("Column"))}
            {word("→")}
            <Txt key={step.to} value={step.to} onCommit={(v) => onChange({ ...step, to: v })} label={t("New name")} placeholder={t("New name")} />
          </>
        )}
        {step.op === "unique" && col(step.col ?? "", (v) => onChange(v ? { ...step, col: v } : { op: "unique" }), t("Column"), t("whole rows"))}
        {step.op === "limit" && <input type="number" min={0} className="input ws-pipe-field w-20" aria-label={t("How many")} value={step.n} onChange={(e) => onChange({ ...step, n: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} />}
      </span>
      <span className="flex items-center gap-0.5">
        {edit && (
          <>
            <button type="button" className={ICON_BTN} title={t("Earlier")} aria-label={t("Earlier")} onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" className={ICON_BTN} title={t("Later")} aria-label={t("Later")} onClick={() => onMove(1)}>
              ↓
            </button>
            <button type="button" className={`${ICON_BTN} hover:!text-red-600`} title={t("Remove this step")} aria-label={t("Remove this step")} onClick={onRemove}>
              ✕
            </button>
          </>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// A table as it is shown
// ---------------------------------------------------------------------------

const SHOWN = 200;

function GridTable({ grid }: { grid: Grid }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const rows = all ? grid.rows : grid.rows.slice(0, SHOWN);
  const isNum = (v: Cell | undefined) =>
    typeof v === "number" ||
    (typeof v === "string" &&
      /^[\d.,\s€$%a-zA-Z]*$/.test(v) &&
      /\d/.test(v) &&
      !/^\d{4}-\d{2}-\d{2}/.test(v) &&
      numOf(v) !== null &&
      /^-?[\d.,]+\s*\S{0,4}$/.test(v.trim()));
  if (!grid.cols.length)
    return <p className="text-sm text-zinc-400">{t("Nothing to show yet.")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {grid.cols.map((c, i) => (
              <th
                key={i}
                className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {grid.cols.map((_, ci) => {
                const v = r[ci];
                return (
                  <td
                    key={ci}
                    className={`border border-zinc-200 px-2 py-1 dark:border-zinc-700 ${isNum(v) ? "text-right tabular-nums" : ""}`}
                  >
                    {typeof v === "number"
                      ? v.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })
                      : v === null || v === undefined
                        ? ""
                        : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td
                colSpan={grid.cols.length}
                className="border border-zinc-200 px-2 py-2 text-center text-zinc-400 dark:border-zinc-700"
              >
                {t("No rows.")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {grid.rows.length > SHOWN && !all && (
        <button
          type="button"
          className="mt-1 text-xs text-indigo-600 hover:underline"
          onClick={() => setAll(true)}
        >
          {t("Show all {n} rows", { n: grid.rows.length })}
        </button>
      )}
    </div>
  );
}

/** A grid as a real table of the page (a copy, to edit and keep as it is now). */
function gridToTable(grid: Grid, name: string): JSONContent {
  const cell = (type: string, text: Cell | undefined): JSONContent => ({
    type,
    content: [
      {
        type: "paragraph",
        ...(text === null || text === undefined || text === ""
          ? {}
          : {
              content: [
                {
                  type: "text",
                  text:
                    typeof text === "number"
                      ? String(text).replace(".", ",")
                      : String(text),
                },
              ],
            }),
      },
    ],
  });
  return {
    type: "table",
    attrs: { name },
    content: [
      {
        type: "tableRow",
        content: grid.cols.map((c) => cell("tableHeader", c)),
      },
      ...grid.rows.map((r) => ({
        type: "tableRow",
        content: grid.cols.map((_, i) => cell("tableCell", r[i])),
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// The transform block
// ---------------------------------------------------------------------------

/** A small caption for a part of the card (its width is the label column of the card). */
function Part({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 ${top ? "items-start" : "items-center"}`}>
      <span className={`text-[11px] font-semibold uppercase tracking-wide text-zinc-400 ${top ? "pt-2" : ""}`}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PipeView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const page = usePage(editor);
  const name = String(node.attrs.name ?? "");
  const fromRaw = String(node.attrs.from ?? "");
  const thisPos = typeof getPos === "function" ? getPos() : undefined;
  const from = fromRaw === ABOVE ? ((thisPos !== undefined && page.aboveOf.get(thisPos)) || "") : fromRaw;
  const steps = useMemo(() => stepsFromText(node.attrs.steps), [node.attrs.steps]);
  const editable = editor.isEditable;
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const [describing, setDescribing] = useState(false);
  const collapsed = node.attrs.collapsed === true;
  const desc = plainDescription(node.attrs.desc);
  const out = name.trim() ? page.outcomes.get(name.trim().toLowerCase()) : undefined;
  // What comes into the block (the columns each step has to work with).
  const input = useMemo(() => outcomeFor(from, page.tables, page.outcomes, page.external), [from, page.tables, page.outcomes, page.external]);
  const colsBefore = useMemo(() => {
    const list: string[][] = [];
    let g: Grid = input.grid;
    for (const s of steps) {
      list.push(g.cols);
      try {
        g = applyStep(g, s);
      } catch {
        // (the columns stay as they were; the step is marked)
      }
    }
    list.push(g.cols);
    return list;
  }, [input, steps]);
  const setSteps = (next: PipeStep[]) => updateAttributes({ steps: stepsToText(normalizeSteps(next)) });
  const failed = out?.error ? Number(/^Step (\d+):/.exec(out.error)?.[1] ?? 0) - 1 : -1;
  const taken = (n: string) => page.tables.some((x) => x.name.trim().toLowerCase() === n.toLowerCase()) || page.pipes.some((p) => p.name.trim().toLowerCase() === n.toLowerCase());

  const ask = async () => {
    setBusy(true);
    const r = await pipeStepsFromTextAction(wish, input.grid.cols, input.grid.rows.slice(0, 6).map((row) => row.map((c) => (c === null ? null : String(c)))), steps);
    setBusy(false);
    if (r.ok) {
      updateAttributes({ steps: stepsToText(normalizeSteps(r.steps)), ...(r.description ? { desc: r.description } : {}) });
      setWish("");
    } else toast(r.error, { tone: "error" });
  };
  const describe = async () => {
    setDescribing(true);
    const r = await pipeDescribeAction(from, input.grid.cols, steps);
    setDescribing(false);
    if (r.ok) updateAttributes({ desc: r.description });
    else toast(r.error, { tone: "error" });
  };
  const showResult = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined) return;
    let n = name.trim();
    if (!n) {
      n = `${t("Result")} ${page.pipes.length}`;
      while (taken(n)) n += "*";
      updateAttributes({ name: n });
    }
    editor.chain().focus().insertContentAt(pos + node.nodeSize, { type: "pipeResult", attrs: { of: n, title: "" } }).run();
  };

  const summary = out ? (
    out.error ? (
      <span className="truncate text-red-600 dark:text-red-400" title={out.error}>{`⚠ ${out.error}`}</span>
    ) : (
      <span className="text-zinc-500">{t("→ {n} rows, {c} columns", { n: out.grid.rows.length, c: out.grid.cols.length })}</span>
    )
  ) : (
    <span className="text-zinc-400">{t("Give it a name to use its result.")}</span>
  );

  return (
    <NodeViewWrapper className="ws-module-block ws-pipe my-2 rounded-xl border border-indigo-200 bg-white/60 shadow-sm dark:border-indigo-900 dark:bg-zinc-900/40" contentEditable={false}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Transform")} />
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button type="button" className={`${ICON_BTN} mt-px`} aria-expanded={!collapsed} title={collapsed ? t("Open the transform") : t("Fold the transform")} aria-label={collapsed ? t("Open the transform") : t("Fold the transform")} onClick={() => updateAttributes({ collapsed: !collapsed })}>
          <span className={`inline-block transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden>
            ▸
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 leading-6">
            <span aria-hidden>🔀</span>
            <Inline value={name} onCommit={(v) => updateAttributes({ name: v })} label={t("Name of this transform")} placeholder={t("Name of this transform")} readOnly={!editable} className="min-w-0 text-sm font-semibold text-zinc-800 dark:text-zinc-100" />
          </div>
          {(desc || editable) && (
            <div className="pl-7 text-xs leading-5 text-zinc-500">
              <Inline value={desc} onCommit={(v) => updateAttributes({ desc: v })} label={t("What this transform does")} placeholder={t("What this transform does — the AI can write it")} readOnly={!editable} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs leading-6">
          {collapsed && summary}
          {editable && (
            <button type="button" className={ICON_BTN} disabled={describing || !steps.length} onClick={() => void describe()} title={!steps.length ? t("Add a step first.") : t("The AI describes the steps in a sentence")} aria-label={desc ? t("✨ Describe again") : t("✨ Describe")}>
              {describing ? "…" : "✨"}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-3 border-t border-indigo-100 px-3 py-3 dark:border-indigo-950">
          <Part label={t("Reads")}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              {editable ? <SourceSelect page={page} editor={editor} value={fromRaw} exclude={name} onChange={(v) => updateAttributes({ from: v })} label={t("Reads from")} /> : <span>{from || "?"}</span>}
              {input.grid.cols.length > 0 && <span className="text-zinc-400">{t("{n} rows in", { n: input.grid.rows.length })}</span>}
              {input.error && !input.grid.cols.length && <span className="text-amber-700 dark:text-amber-300">{input.error}</span>}
            </div>
          </Part>

          <Part label={t("Steps")} top>
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <StepRow
                  key={`${i}-${s.op}`}
                  n={i + 1}
                  step={s}
                  cols={colsBefore[i] ?? []}
                  edit={editable}
                  error={i === failed}
                  onChange={(ns) => setSteps(steps.map((x, k) => (k === i ? ns : x)))}
                  onMove={(d) => {
                    const j = i + d;
                    if (j < 0 || j >= steps.length) return;
                    const next = [...steps];
                    [next[i], next[j]] = [next[j], next[i]];
                    setSteps(next);
                  }}
                  onRemove={() => setSteps(steps.filter((_, k) => k !== i))}
                />
              ))}
              {!steps.length && <li className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-700">{t("No steps yet — the rows pass through as they are.")}</li>}
            </ol>
          </Part>

          {editable && (
            <Part label={t("Add")}>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input ws-pipe-field" aria-label={t("Add a step")} value="" onChange={(e) => e.target.value && setSteps([...steps, newStep(e.target.value as (typeof OPS)[number], colsBefore[steps.length] ?? [])])}>
                  <option value="">{t("＋ Add a step")}</option>
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL(t)[o]}
                    </option>
                  ))}
                </select>
                <input
                  value={wish}
                  onChange={(e) => setWish(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && wish.trim() && !busy) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  placeholder={t("Or say it: only amounts over 50, biggest first")}
                  aria-label={t("Describe what should happen")}
                  className="input ws-pipe-field min-w-48 flex-1"
                />
                <button type="button" className="btn btn-sm h-7" disabled={busy || !wish.trim() || !input.grid.cols.length} onClick={() => void ask()} title={!input.grid.cols.length ? t("Pick what this reads from first.") : undefined}>
                  {busy ? "…" : t("✨ Make steps")}
                </button>
              </div>
            </Part>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-indigo-100 pt-2.5 text-xs dark:border-indigo-950">
            <div className="min-w-0 flex-1">{summary}</div>
            {editable && (
              <button type="button" className="shrink-0 text-indigo-600 hover:underline dark:text-indigo-300" onClick={showResult}>
                {t("Show result as a table below")}
              </button>
            )}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const TablePipeNode = Node.create({
  name: "tablePipe",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      name: { default: "" },
      from: { default: "" },
      steps: { default: "" },
      desc: { default: "" },
      collapsed: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-table-pipe]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-table-pipe": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PipeView);
  },
});

// ---------------------------------------------------------------------------
// The result table
// ---------------------------------------------------------------------------

function ResultView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const page = usePage(editor);
  const ofRaw = String(node.attrs.of ?? "");
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const of = ofRaw === ABOVE ? ((pos !== undefined && page.aboveOf.get(pos)) || "") : ofRaw;
  const editable = editor.isEditable;
  const o = useMemo(() => outcomeFor(of, page.tables, page.outcomes, page.external), [of, page.tables, page.outcomes, page.external]);
  const copy = () => {
    const at = typeof getPos === "function" ? getPos() : undefined;
    if (at === undefined) return;
    editor.chain().focus().insertContentAt(at + node.nodeSize, gridToTable(o.grid, "")).run();
  };
  const named = page.tables.filter((x) => x.name.trim());
  const unnamed = page.tables.filter((x) => !x.name.trim());
  const pipes = page.pipes.filter((p) => p.name.trim());
  const pick = (v: string, close: () => void) => {
    updateAttributes({ of: v });
    close();
  };
  // A table that is worked out, not typed: its stripe and its chip say so (data-flow-ext.ts); the choice of its input is in its menu, top right.
  return (
    <NodeViewWrapper className="ws-module-block ws-computed group relative my-2 space-y-2" contentEditable={false}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Result table")} />
      {editable && (
        <div className="absolute top-1 right-1 z-10 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Dropdown label="⋯" title={t("Input and options of this table")} ariaLabel={t("Input and options of this table")} className="flex h-6 w-6 items-center justify-center rounded bg-white/80 text-zinc-500 shadow-sm hover:text-zinc-800 dark:bg-zinc-900/80" align="right">
            {(close) => (
              <div className="w-60">
                <MenuSection title={t("Input")}>
                  <MenuItem checked={ofRaw === ABOVE} onClick={() => pick(ABOVE, close)}>
                    {t("↑ The block above (pipeline)")}
                  </MenuItem>
                  {named.map((x) => (
                    <MenuItem key={`t${x.pos}`} checked={ofRaw === x.name} onClick={() => pick(x.name, close)}>
                      <span className="truncate">{`▦ ${x.name}`}</span>
                    </MenuItem>
                  ))}
                  {unnamed.map((x) => (
                    <MenuItem key={`u${x.pos}`} onClick={() => pick(giveName(editor, page, x.pos, t("Table")), close)}>
                      <span className="truncate">{`▦ ${t("Table")} ${page.tables.findIndex((y) => y.pos === x.pos) + 1} ${t("(gets a name)")}`}</span>
                    </MenuItem>
                  ))}
                  {pipes.map((p) => (
                    <MenuItem key={`p${p.name}`} checked={ofRaw === p.name} onClick={() => pick(p.name, close)}>
                      <span className="truncate">{`🔀 ${p.name}`}</span>
                    </MenuItem>
                  ))}
                  {page.dbs.map((d) => (
                    <MenuItem key={`d${d.id}`} checked={ofRaw === `db:${d.id}`} onClick={() => pick(`db:${d.id}`, close)}>
                      <span className="truncate">{`🗃 ${d.title}`}</span>
                    </MenuItem>
                  ))}
                </MenuSection>
                <MenuSection title={t("Table")}>
                  <MenuItem
                    disabled={!o.grid.cols.length}
                    onClick={() => {
                      copy();
                      close();
                    }}
                  >
                    {t("Copy as a table to edit")}
                  </MenuItem>
                </MenuSection>
              </div>
            )}
          </Dropdown>
        </div>
      )}
      {String(node.attrs.title ?? "").trim() && <p className="text-xs font-medium text-zinc-500">{`📋 ${String(node.attrs.title).trim()}`}</p>}
      {o.error && <p className="text-xs text-red-600 dark:text-red-400">{`⚠ ${o.error}`}</p>}
      {(!o.error || o.grid.cols.length > 0) && of && <GridTable grid={o.grid} />}
      {!of && <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-400 dark:border-zinc-700">{t("No input yet — choose it in the ⋯ menu, top right.")}</p>}
    </NodeViewWrapper>
  );
}

export const PipeResultNode = Node.create({
  name: "pipeResult",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { of: { default: "" }, title: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-pipe-result]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-pipe-result": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResultView);
  },
});

/** A ready-made example for the "/" menu: its title, its data table, the transform and the table with the result (the data is German, as a household's is). */
export function exampleContent(title: string, e: PipeExample): JSONContent[] {
  return [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: title }],
    },
    gridToTable({ cols: e.cols, rows: e.rows }, e.name),
    {
      type: "tablePipe",
      attrs: { name: e.outName, from: e.name, steps: stepsToText(e.steps) },
    },
    { type: "pipeResult", attrs: { of: e.outName, title: "" } },
    { type: "paragraph" },
  ];
}
