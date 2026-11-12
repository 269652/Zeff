import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PmNode, type NodeRange } from "@tiptap/pm/model";
import type { T } from "@/lib/i18n/shared";
import type { WrapPlan } from "../wrap-plan";

/**
 * Wrapping blocks in a container and taking them out again (the menu of a block's handle): a panel, a box, a toggle, columns,
 * tabs. The blocks wrapped are the selection's, or — with none touching the block the handle is on — that block alone.
 */

export type Handle = { pos: number; size: number } | null;

/** The blocks wrapping would take: those of the selection when it touches the handle's block, else that block. */
export function wrapRange(editor: Editor, handle: Handle): NodeRange | null {
  const { state } = editor;
  const sel = state.selection;
  if (handle && (sel.empty || sel.to < handle.pos || sel.from > handle.pos + handle.size)) {
    try {
      return state.doc.resolve(handle.pos).blockRange(state.doc.resolve(handle.pos + handle.size));
    } catch {
      return null;
    }
  }
  return sel.$from.blockRange(sel.$to);
}

const textOf = (n: PmNode): string => n.textBetween(0, n.content.size, " ", " ").replace(/\s+/g, " ").trim();

/** What the AI is told about the blocks to wrap: their kinds and the start of their text. */
export function rangeBlocks(range: NodeRange): { type: string; text: string }[] {
  const out: { type: string; text: string }[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) {
    const n = range.parent.child(i);
    out.push({ type: n.type.name, text: textOf(n).slice(0, 80) });
  }
  return out;
}

/** The container a plan makes, around these blocks (JSON of the document model). */
function containerJson(t: T, kids: Record<string, unknown>[], plan: WrapPlan, firstTexts: string[]): Record<string, unknown> {
  switch (plan.container) {
    case "panel":
      return { type: "panel", attrs: { title: plan.title ?? "", desc: plan.desc ?? "", collapsed: false }, content: kids };
    case "callout":
      return { type: "callout", attrs: { icon: plan.icon ?? "💡", tone: plan.tone ?? "gray" }, content: kids };
    case "toggle":
      return { type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", content: [{ type: "text", text: plan.title || t("Details") }] }, { type: "detailsContent", content: kids }] };
    case "columns": {
      const n = Math.min(4, Math.max(2, plan.count ?? Math.min(kids.length, 4)));
      // (The blocks in order, as evenly as they go: 5 blocks in 2 columns are 3 and 2.)
      const cols: Record<string, unknown>[][] = Array.from({ length: n }, () => []);
      let k = 0;
      for (let c = 0; c < n; c++) {
        const take = Math.ceil((kids.length - k) / (n - c));
        cols[c] = kids.slice(k, k + take);
        k += take;
      }
      return { type: "flexBox", attrs: { dir: "row", gap: "md" }, content: cols.map((c) => ({ type: "flexBox", attrs: { dir: "col", gap: "md" }, content: c.length ? c : [{ type: "paragraph" }] })) };
    }
    case "tabs":
      return {
        type: "zeffTabs",
        attrs: { active: 0 },
        content: kids.map((k, i) => ({ type: "zeffTab", attrs: { title: (plan.titles?.[i] || firstTexts[i] || t("Tab {n}", { n: i + 1 })).slice(0, 60) }, content: [k] })),
      };
  }
}

/** The blocks of the range wrapped in the container the plan says. False: it could not be done (nothing changed). */
export function wrapBlocks(editor: Editor, t: T, range: NodeRange, plan: WrapPlan): boolean {
  const kids: Record<string, unknown>[] = [];
  const firstTexts: string[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) {
    kids.push(range.parent.child(i).toJSON() as Record<string, unknown>);
    firstTexts.push(textOf(range.parent.child(i)).slice(0, 40));
  }
  if (!kids.length) return false;
  try {
    const node = editor.schema.nodeFromJSON(containerJson(t, kids, plan, firstTexts));
    editor.view.dispatch(editor.state.tr.replaceWith(range.start, range.end, node).scrollIntoView());
    return true;
  } catch {
    return false;
  }
}

const CONTAINER_TYPES = new Set(["panel", "callout", "details", "flexBox", "zeffTabs"]);

/** The container to take apart: the block of the handle if it is one, else the nearest one around it. */
export function containerAt(editor: Editor, handle: Handle): { pos: number; node: PmNode } | null {
  if (!handle) return null;
  const { doc } = editor.state;
  const own = doc.nodeAt(handle.pos);
  const $ = doc.resolve(handle.pos);
  const candidates: { pos: number; node: PmNode; parent: PmNode | null }[] = [];
  if (own && CONTAINER_TYPES.has(own.type.name)) candidates.push({ pos: handle.pos, node: own, parent: $.parent });
  for (let d = $.depth; d > 0; d--) candidates.push({ pos: $.before(d), node: $.node(d), parent: $.node(d - 1) });
  for (const c of candidates) {
    if (!CONTAINER_TYPES.has(c.node.type.name)) continue;
    // (A column of a row of columns: the row is the container.)
    if (c.node.type.name === "flexBox" && c.node.attrs.dir === "col" && c.parent?.type.name === "flexBox" && c.parent.attrs.dir === "row") continue;
    return { pos: c.pos, node: c.node };
  }
  return null;
}

/** The container taken apart: what was in it stands in its place (a toggle's summary as a line of its own; tabs' titles are dropped). */
export function unwrapAt(editor: Editor, c: { pos: number; node: PmNode }): boolean {
  const { node } = c;
  const out: PmNode[] = [];
  node.forEach((child) => {
    switch (node.type.name) {
      case "details":
        if (child.type.name === "detailsSummary") {
          const s = textOf(child);
          if (s) out.push(editor.schema.nodes.paragraph.create(null, editor.schema.text(s)));
        } else child.forEach((x) => out.push(x));
        break;
      case "flexBox":
        if (child.type.name === "flexBox") child.forEach((x) => out.push(x));
        else out.push(child);
        break;
      case "zeffTabs":
        child.forEach((x) => out.push(x));
        break;
      default:
        out.push(child);
    }
  });
  if (!out.length) return false;
  try {
    editor.view.dispatch(editor.state.tr.replaceWith(c.pos, c.pos + node.nodeSize, Fragment.fromArray(out)).scrollIntoView());
    return true;
  } catch {
    return false;
  }
}
