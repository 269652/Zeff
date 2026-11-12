import { Extension } from "@tiptap/react";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { currentDir, nextDir, sortOrder } from "../table-sort";

/**
 * A sort button in the header cells of a page's table (/Tabelle): ⇅ — a click sorts the rows under the header by that column
 * (ascending, then descending), ▲ / ▼ show how it is sorted now. Not offered where it would do harm: a protected table, a table
 * with formulas (their cell addresses would shift), merged cells (the columns don't line up).
 */

export type SortLabels = { sort: string; asc: string; desc: string; locked: string; formulas: string; merged: string };
const NO_LABELS: SortLabels = { sort: "Sort by this column", asc: "Sorted ascending — click for descending", desc: "Sorted descending — click for ascending", locked: "Protected table — allow editing to sort", formulas: "A table with formulas can't be sorted", merged: "A table with merged cells can't be sorted" };

const text = (cell: PmNode) => cell.textContent;

/** The table's rows: how many are header rows at the top (all cells headers), and why it can't be sorted (if so). */
function analyse(table: PmNode, labels: SortLabels): { headerRows: number; blocked: string | null } {
  let headerRows = 0;
  let leading = true;
  let blocked: string | null = null;
  table.forEach((row) => {
    const allHeader = row.childCount > 0 && Array.from({ length: row.childCount }, (_, i) => row.child(i)).every((c) => c.type.name === "tableHeader");
    if (leading && allHeader) headerRows++;
    else leading = false;
    row.forEach((cell) => {
      if ((cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1) blocked = labels.merged;
      if (!allHeader && text(cell).trimStart().startsWith("=")) blocked ??= labels.formulas;
    });
  });
  if (table.attrs.locked === true) blocked = labels.locked;
  return { headerRows, blocked };
}

export const TableSort = Extension.create<{ labels: SortLabels }>({
  name: "tableSort",
  addOptions() {
    return { labels: NO_LABELS };
  },
  addProseMirrorPlugins() {
    const labels = this.options.labels;
    const decorate = (doc: PmNode): DecorationSet => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== "table") return true;
        const { headerRows, blocked } = analyse(node, labels);
        if (!headerRows || headerRows >= node.childCount) return false; // no header, or nothing under it
        // The header row the buttons sit in: the last one of the header.
        let rowPos = pos + 1;
        for (let r = 0; r < headerRows - 1; r++) rowPos += node.child(r).nodeSize;
        const headRow = node.child(headerRows - 1);
        headRow.forEach((cell, off, col) => {
          const cellPos = rowPos + 1 + off;
          const body: string[] = [];
          for (let r = headerRows; r < node.childCount; r++) body.push(col < node.child(r).childCount ? text(node.child(r).child(col)) : "");
          const dir = blocked ? null : currentDir(body);
          const title = blocked ?? (dir === "asc" ? labels.asc : dir === "desc" ? labels.desc : labels.sort);
          decos.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: "ws-has-sort" }));
          decos.push(
            Decoration.widget(
              cellPos + 1,
              (view) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = `ws-sort-btn${dir ? " is-sorted" : ""}`;
                b.contentEditable = "false";
                b.textContent = dir === "asc" ? "▲" : dir === "desc" ? "▼" : "⇅";
                b.title = title;
                b.setAttribute("aria-label", title);
                if (blocked) b.disabled = true;
                b.addEventListener("mousedown", (e) => {
                  e.preventDefault();
                  if (blocked) return;
                  // Found again by where it stands now (the document may have changed since it was drawn).
                  const here = view.posAtDOM(b, 0);
                  const $h = view.state.doc.resolve(here);
                  let d = $h.depth;
                  while (d > 0 && $h.node(d).type.name !== "table") d--;
                  if (!d) return;
                  const tablePos = $h.before(d);
                  const t = $h.node(d);
                  const a = analyse(t, labels);
                  if (a.blocked || !a.headerRows) return;
                  const rows: PmNode[] = [];
                  for (let r = a.headerRows; r < t.childCount; r++) rows.push(t.child(r));
                  const cells = rows.map((row) => (col < row.childCount ? text(row.child(col)) : ""));
                  const order = sortOrder(cells, nextDir(cells));
                  let from = tablePos + 1;
                  for (let r = 0; r < a.headerRows; r++) from += t.child(r).nodeSize;
                  const to = tablePos + t.nodeSize - 1;
                  view.dispatch(view.state.tr.replaceWith(from, to, Fragment.from(order.map((i) => rows[i]))).scrollIntoView());
                });
                return b;
              },
              { side: -1, ignoreSelection: true, stopEvent: () => true, key: `sort:${cellPos}:${dir}:${blocked ?? ""}` },
            ),
          );
        });
        return false;
      });
      return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
    };
    return [
      new Plugin<DecorationSet>({
        key: new PluginKey("tableSort"),
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});
