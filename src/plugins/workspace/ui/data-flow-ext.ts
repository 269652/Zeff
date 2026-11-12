import { Extension } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { computeFlows, widgetFlows, type FlowBlock, type FlowMark } from "../data-flow";

/**
 * Shows where a page's data goes (data-flow.ts): the blocks on a connection — a table that a transform reads, the transform, the
 * result table that shows it, widgets that share values — get a stripe in the connection's colour, and a small chip above them with
 * a link: "🔗 ↑ Ausgaben" (reads from the block above) and "→ Ergebnis" (feeds). A click on a source jumps to it.
 */

/** The transaction that switches a table's protection (the only one a protected table lets through). */
export const LOCK_META = "tableLockSwitch";
export const dataFlowKey = new PluginKey<DecorationSet>("dataFlow");

type Located = FlowBlock & { size: number; locked?: boolean };
export type FlowLabels = { editable: string; locked: string; computed: string; result: string; protect: string; unprotect: string };
const NO_LABELS: FlowLabels = { editable: "Editable", locked: "Protected", computed: "Calculated", result: "Result table", protect: "Click to protect against editing", unprotect: "Click to allow editing" };
const MODE_COLOR = { edit: "#22c55e", locked: "#eab308", computed: "#8b5cf6" } as const;

function blocksOf(doc: PmNode): Located[] {
  const out: Located[] = [];
  doc.descendants((n, pos) => {
    const size = n.nodeSize;
    switch (n.type.name) {
      case "table": {
        const name = String(n.attrs.name ?? "").trim();
        out.push({ pos, size, kind: "table", name, reads: [], writes: name ? [name] : [], locked: n.attrs.locked === true });
        return false;
      }
      case "tablePipe": {
        const name = String(n.attrs.name ?? "").trim();
        const from = String(n.attrs.from ?? "").trim();
        out.push({ pos, size, kind: "pipe", name, reads: from ? [from] : [], writes: name ? [name] : [] });
        return false;
      }
      case "codeCell": {
        const name = String(n.attrs.name ?? "").trim();
        let inputs: string[] = [];
        try {
          const v = JSON.parse(String(n.attrs.inputs || "[]")) as unknown;
          inputs = Array.isArray(v) ? v.map(String).filter(Boolean) : [];
        } catch {
          inputs = [];
        }
        if (name || inputs.length) out.push({ pos, size, kind: "code", name, label: name || "Code", reads: inputs, writes: name ? [name] : [] });
        return false;
      }
      case "pipeResult": {
        const of = String(n.attrs.of ?? "").trim();
        out.push({ pos, size, kind: "result", name: "", label: "@result", reads: of ? [of] : [], writes: [] });
        return false;
      }
      case "zeffApp": {
        const f = widgetFlows(String(n.attrs.html ?? ""));
        if (f.reads.length || f.writes.length) out.push({ pos, size, kind: "widget", name: String(n.attrs.title ?? ""), reads: f.reads, writes: f.writes });
        return false;
      }
    }
    return true;
  });
  return out;
}

function chip(view: import("@tiptap/pm/view").EditorView, m: FlowMark, mode: { kind: keyof typeof MODE_COLOR; label: string } | null, table: { pos: number; hint: string } | null, side: "in" | "out"): HTMLElement {
  const el = document.createElement("div");
  el.className = side === "out" ? "ws-flow-chip ws-flow-out" : "ws-flow-chip";
  el.contentEditable = "false";
  el.style.setProperty("--flow", m.color || (mode ? MODE_COLOR[mode.kind] : "#71717a"));
  const link = () => {
    const icon = document.createElement("span");
    icon.className = "ws-flow-icon";
    icon.textContent = "🔗";
    return icon;
  };
  const part = (text: string, color: string, title: string, jump?: number) => {
    const s = document.createElement("span");
    s.className = "ws-flow-part";
    s.style.setProperty("--flow", color);
    s.textContent = text;
    s.title = title;
    if (jump !== undefined) {
      s.dataset.jump = "1";
      s.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const dom = view.nodeDOM(jump);
        if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    el.append(s);
  };
  // Above the block: what comes in, then how the table is kept (worked out here, typed, protected). Below it: what goes out.
  if (side === "in" && m.reads.length) {
    el.append(link());
    // (The arrow is the way the data goes: what comes from a block above flows down into this one.)
    for (const r of m.reads) part(`${r.name} ${r.dir === "up" ? "↓" : "↑"}`, r.color, r.name, r.from);
  }
  if (side === "in" && mode) {
    const pill = document.createElement("span");
    pill.className = "ws-flow-part ws-mode-pill";
    pill.style.setProperty("--flow", MODE_COLOR[mode.kind]);
    pill.textContent = `${mode.kind === "edit" ? "✎" : mode.kind === "locked" ? "🔒" : "⚡"} ${mode.label}`;
    if (table && view.editable) {
      // The pill of a table is its switch: a protected table has no caret in it, so its menu cannot be reached from inside.
      pill.dataset.jump = "1";
      pill.title = table.hint;
      pill.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const node = view.state.doc.nodeAt(table.pos);
        if (node && node.type.name === "table") view.dispatch(view.state.tr.setNodeMarkup(table.pos, undefined, { ...node.attrs, locked: node.attrs.locked !== true }).setMeta(LOCK_META, true));
      });
    }
    el.append(pill);
  }
  if (side === "out" && m.feeds.length) {
    el.append(link());
    for (const f of m.feeds) part(`${f.dir === "down" ? "↓" : "↑"} ${f.name}`, f.color, f.name, f.to);
  }
  return el;
}

function decorate(doc: PmNode, labels: FlowLabels): DecorationSet {
  const blocks = blocksOf(doc).map((b) => (b.label === "@result" ? { ...b, label: labels.result } : b));
  if (!blocks.length) return DecorationSet.empty;
  const { marks } = computeFlows(blocks);
  const decos: Decoration[] = [];
  for (const b of blocks) {
    const m = marks.get(b.pos) ?? { color: "", reads: [], feeds: [] };
    const mode = b.kind === "table" ? (b.locked ? ({ kind: "locked", label: labels.locked } as const) : ({ kind: "edit", label: labels.editable } as const)) : b.kind === "result" ? ({ kind: "computed", label: labels.computed } as const) : null;
    if (!mode && !m.reads.length && !m.feeds.length) continue;
    const linked = m.reads.length > 0 || m.feeds.length > 0;
    decos.push(
      Decoration.node(b.pos, b.pos + b.size, {
        // (Two stripes: the colour of its flow — the pipeline it belongs to — and, for a table, of how it is kept.)
        class: `${linked ? "ws-flow" : ""} ${mode ? `ws-mode ws-mode-${mode.kind}` : ""}`.trim(),
        style: `${linked ? `--flow: ${m.color};` : ""}${mode ? ` --mode: ${MODE_COLOR[mode.kind]};` : ""}`,
        // (A protected table cannot be put into: no caret in it.)
        ...(mode?.kind === "locked" ? { contenteditable: "false", "data-locked": "true" } : {}),
      }),
    );
    const tableHint = b.kind === "table" ? { pos: b.pos, hint: b.locked ? labels.unprotect : labels.protect } : null;
    const sig = `${mode?.kind ?? ""}:${mode?.label ?? ""}:${m.color}`;
    // (Above the block: what flows in, and how the table is kept.)
    if (mode || m.reads.length) {
      decos.push(Decoration.widget(b.pos, (view) => chip(view, m, mode, tableHint, "in"), { side: -1, key: `in:${b.pos}:${sig}:${m.reads.map((r) => `${r.name}${r.dir}`).join(",")}`, ignoreSelection: true }));
    }
    // (Below it: where its data goes — unless that is the block right below, which shows where it comes from itself.)
    const far = { ...m, feeds: m.feeds.filter((f) => !(f.dir === "down" && f.to === b.pos + b.size)) };
    if (far.feeds.length) {
      decos.push(Decoration.widget(b.pos + b.size, (view) => chip(view, far, null, null, "out"), { side: 1, key: `out:${b.pos}:${sig}:${far.feeds.map((f) => `${f.name}${f.dir}`).join(",")}`, ignoreSelection: true }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export const DataFlow = Extension.create<{ labels: FlowLabels }>({
  name: "dataFlow",
  addOptions() {
    return { labels: NO_LABELS };
  },
  addProseMirrorPlugins() {
    const labels = () => this.options.labels;
    return [
      new Plugin<DecorationSet>({
        key: dataFlowKey,
        state: {
          init: (_, state) => decorate(state.doc, labels()),
          apply: (tr, old, _before, state) => (tr.docChanged || tr.getMeta(dataFlowKey) ? decorate(state.doc, labels()) : old),
        },
        props: { decorations: (state) => dataFlowKey.getState(state) },
      }),
      // A protected table (⋯ menu of a table) takes no change — typing, pasting, rows, deleting it — except the switch itself.
      new Plugin({
        key: new PluginKey("tableLock"),
        filterTransaction: (tr) => {
          if (!tr.docChanged || tr.getMeta(LOCK_META)) return true;
          for (let i = 0; i < tr.steps.length; i++) {
            const before = tr.docs[i];
            const locked: [number, number][] = [];
            before.descendants((n, pos) => {
              if (n.type.name !== "table") return true;
              if (n.attrs.locked === true) locked.push([pos, pos + n.nodeSize]);
              return false;
            });
            if (!locked.length) continue;
            let hit = false;
            tr.steps[i].getMap().forEach((from, to) => {
              for (const [a, b] of locked) if (from === to ? from > a && from < b : to > a && from < b) hit = true;
            });
            if (hit) return false;
          }
          return true;
        },
      }),
    ];
  },
});
