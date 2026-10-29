import { Extension } from "@tiptap/react";
import { Table } from "@tiptap/extension-table";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { refToken, type RefKind } from "../formula";
import { evaluatePageTables, formatCellValue, PENDING, type FormulaData, type PageTable, type PendingCall } from "../page-sheet";

/**
 * Formulas in a page's tables (/Tabelle), in the editor: a cell that starts with "=" shows what it works out to (page-sheet.ts);
 * the caret in it shows the formula, with its value beside. A table can have a name (its ⋯ menu, table-tools.tsx) — the other
 * tables of the page read it by that name. What only the server knows (the Kennzahlen, the shared tables) is asked once the
 * page has a formula.
 */

/** The table with a name for formulas (kept as data-sheet; doc.ts keeps the attribute). */
export const SheetTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      name: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-sheet") ?? "",
        renderHTML: (a: { name?: string }) => (a.name ? { "data-sheet": a.name } : {}),
      },
    };
  },
});

export const tableFormulasKey = new PluginKey<DecorationSet>("tableFormulas");

/** A cell's text as a formula reads it: its paragraphs, a mention as [[kind:ref|Label]]. */
function cellText(cell: PmNode): string {
  const parts: string[] = [];
  cell.forEach((block) => {
    let line = "";
    block.descendants((n) => {
      if (n.isText) line += n.text ?? "";
      else if (n.type.name === "zeffRef") line += refToken(String(n.attrs.kind) as RefKind, String(n.attrs.ref ?? ""), String(n.attrs.label ?? ""));
      else if (n.type.name === "hardBreak") line += " ";
      return true;
    });
    parts.push(line);
  });
  return parts.join(" ");
}

/** The page's tables as grids (cells with where they stand). */
export function pageTables(doc: PmNode): PageTable[] {
  const out: PageTable[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const rows: PageTable["rows"] = [];
    node.forEach((row, rowOff) => {
      const cells: PageTable["rows"][number] = [];
      row.forEach((cell, cellOff) => cells.push({ text: cellText(cell), pos: pos + 1 + rowOff + 1 + cellOff, size: cell.nodeSize, header: cell.type.name === "tableHeader" }));
      rows.push(cells);
    });
    out.push({ name: String(node.attrs.name ?? ""), pos, rows });
    return false;
  });
  return out;
}

/** The cell (and its table) the selection is in: its column and row (0-based), or null. */
export function cellAt(state: EditorState): { table: PageTable; row: number; col: number } | null {
  const head = state.selection.$head;
  for (let d = head.depth; d > 0; d--) {
    if (head.node(d).type.name !== "table") continue;
    const table = pageTables(state.doc).find((t) => t.pos === head.before(d));
    if (!table) return null;
    for (let r = 0; r < table.rows.length; r++) for (let c = 0; c < table.rows[r].length; c++) {
      const cell = table.rows[r][c];
      if (head.pos > cell.pos && head.pos < cell.pos + cell.size) return { table, row: r, col: c };
    }
    return null;
  }
  return null;
}

type Options = { getData: () => FormulaData | null; requestData: () => void; requestCalls: (calls: PendingCall[]) => void; locale: () => string | undefined };

function decorate(state: EditorState, opts: Options): DecorationSet {
  const tables = pageTables(state.doc);
  const formulaCells = tables.flatMap((t) => t.rows.flat()).filter((c) => c.text.trimStart().startsWith("="));
  if (!formulaCells.length) return DecorationSet.empty;
  const data = opts.getData();
  if (!data) opts.requestData();
  const pending: PendingCall[] = [];
  const results = evaluatePageTables(tables, data ?? { metrics: {}, sheets: {} }, pending);
  if (data && pending.length) opts.requestCalls(pending);
  const head = state.selection.head;
  const decos: Decoration[] = [];
  for (const cell of formulaCells) {
    const r = results.get(cell.pos) ?? { value: null };
    // (its unit after it; units that don't go together: a ⚠ after it, what didn't fit in its title)
    const warned = !r.error && !!r.warnings?.length;
    // (still asked of the server — the Kennzahlen, a plugin's function: "…", no error)
    const waiting = r.error === PENDING || (!data && !!r.error);
    if (waiting) r.error = undefined;
    const shown = waiting ? PENDING : r.error ? `⚠ ${r.error}` : `${formatCellValue(r.value, opts.locale(), r.unit)}${warned ? " ⚠" : ""}`;
    const inside = head > cell.pos && head < cell.pos + cell.size;
    if (inside) {
      // Being written: the formula as it is, its value beside it.
      decos.push(Decoration.node(cell.pos, cell.pos + cell.size, { class: "ws-formula-editing" }));
      decos.push(Decoration.widget(cell.pos + cell.size - 1, () => Object.assign(document.createElement("span"), { className: `ws-formula-preview ${r.error ? "is-error" : ""}`, textContent: `= ${shown}${warned ? ` ${r.warnings!.join("; ")}` : ""}` }), { side: 1, ignoreSelection: true }));
      continue;
    }
    decos.push(Decoration.node(cell.pos, cell.pos + cell.size, { class: `ws-formula-cell ${r.error ? "is-error" : ""} ${warned ? "has-warning" : ""}`, title: [cell.text, r.error, ...(warned ? r.warnings! : [])].filter(Boolean).join("\n") }));
    decos.push(
      Decoration.widget(
        cell.pos + 1,
        (view) => {
          const el = Object.assign(document.createElement("span"), { className: `ws-formula-value ${typeof r.value === "number" && !r.error ? "is-num" : ""}`, textContent: shown || "\u00a0" });
          el.contentEditable = "false";
          // A click puts the caret into the formula.
          el.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const at = view.state.doc.resolve(Math.max(cell.pos + 1, cell.pos + cell.size - 2));
            view.dispatch(view.state.tr.setSelection(TextSelection.near(at, -1)));
            view.focus();
          });
          return el;
        },
        { side: -1, key: `f${cell.pos}:${typeof r.value}:${shown}` },
      ),
    );
  }
  return DecorationSet.create(state.doc, decos);
}

export const TableFormulas = Extension.create<Options>({
  name: "tableFormulas",
  addOptions() {
    return { getData: () => null, requestData: () => undefined, requestCalls: () => undefined, locale: () => undefined };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: tableFormulasKey,
        state: {
          init: (_, state) => decorate(state, opts),
          apply: (tr, old, _before, state) => (tr.docChanged || tr.selectionSet || tr.getMeta(tableFormulasKey) ? decorate(state, opts) : old.map(tr.mapping, tr.doc)),
        },
        props: { decorations: (state) => tableFormulasKey.getState(state) },
      }),
    ];
  },
});
