import { Extension } from "@tiptap/core";
import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Blocks drawn by React (widgets, your own blocks, views, forms …) handled like blocks of text:
 * - a block picked (clicked, or reached with the arrow keys) is shown as picked; so is every block inside a selection that runs
 *   over several (dragged across, Shift+arrows, Ctrl+A) — Delete / Backspace take them out;
 * - a click in the space between two such blocks (or above the first, below the last) puts the cursor there — a line across the
 *   page, or across a column; between two columns of a row a line down — at any depth; typing or Enter starts a new line in that place;
 * - a picked block: Ctrl+D doubles it, Alt+↑ / Alt+↓ move it, Escape lets go of it.
 */

/** Whether the cursor between blocks can stand at `$pos` (prosemirror-gapcursor's own test; not in its typings). */
const gapValid = ($pos: ResolvedPos): boolean => (GapCursor as unknown as { valid($p: ResolvedPos): boolean }).valid($pos);

export const blockSelectKey = new PluginKey("wsBlockSelect");

/** A block that is no text: drawn by itself (a widget, a view, an image …). */
export const isObjectBlock = (n: PmNode | null | undefined): n is PmNode => !!n && n.isBlock && !n.isTextblock && (n.isAtom || n.isLeaf);

/** What a click inside a block is meant for, not for picking the block. */
const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="tab"], [data-no-pick]';

/** Whether the click on `target` is meant for something inside the block `block` (the page itself is contenteditable too). */
export const interactiveIn = (block: HTMLElement, target: HTMLElement): boolean => {
  const hit = target.closest(INTERACTIVE);
  return !!hit && block.contains(hit) && hit !== block;
};

type ViewDesc = { node?: PmNode; dom?: Node; posBefore?: number };
/** The innermost block holding no text that `target` is in, with where it stands. */
export function blockAt(view: EditorView, target: Node | null): { pos: number; el: HTMLElement; node: PmNode } | null {
  for (let n: Node | null = target; n && n !== view.dom; n = n.parentNode) {
    const desc = (n as Node & { pmViewDesc?: ViewDesc }).pmViewDesc;
    if (desc?.node && desc.dom === n && isObjectBlock(desc.node) && typeof desc.posBefore === "number" && n instanceof HTMLElement) return { pos: desc.posBefore, el: n, node: desc.node };
  }
  return null;
}

/** The top-level gap (a position between two top-level blocks, or at the start / end) nearest to `y`, and the line it is drawn at. */
export function gapAt(view: EditorView, y: number): { pos: number; y: number; before: PmNode | null; after: PmNode | null } | null {
  const doc = view.state.doc;
  let pos = 0;
  let prevBottom: number | null = null;
  let prev: PmNode | null = null;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      // (a block's frame has room around what it draws — that room counts as the gap)
      const r = (dom.querySelector(":scope > [data-node-view-wrapper]") ?? dom).getBoundingClientRect();
      if (y < r.top) {
        // Above this block: the gap before it (between the previous one's bottom and its top).
        if (prevBottom === null || y >= prevBottom - 1) return { pos, y: prevBottom === null ? r.top - 4 : (prevBottom + r.top) / 2, before: prev, after: child };
        return null;
      }
      if (y <= r.bottom) return null;
      prevBottom = r.bottom;
    }
    prev = child;
    pos += child.nodeSize;
  }
  return prevBottom !== null ? { pos, y: prevBottom + 4, before: prev, after: null } : null;
}

/** A block that holds no text itself: one drawn by itself, or a box of blocks (a row, a column, a callout …). */
export const isNonTextBlock = (n: PmNode | null | undefined): n is PmNode => !!n && n.isBlock && !n.isTextblock;

type Container = { node: PmNode; start: number; el: HTMLElement };

/**
 * The box of blocks a click on `target` landed in, in its own space (between its blocks, not on one): the page itself, or a row,
 * a column, a callout … at any depth. A block's frame (the room around what it draws) counts as the space around it. null: the
 * click is on a block or in a line of text.
 */
function containerAt(view: EditorView, target: HTMLElement): Container | null {
  for (let n: Node | null = target; n; n = n.parentNode) {
    if (n === view.dom) return { node: view.state.doc, start: 0, el: view.dom };
    const desc: (ViewDesc & { contentDOM?: Node | null }) | undefined = (n as Node & { pmViewDesc?: ViewDesc & { contentDOM?: Node | null } }).pmViewDesc;
    if (!desc?.node || desc.dom !== n || typeof desc.posBefore !== "number") continue;
    if (desc.node.isTextblock) return null;
    if (isObjectBlock(desc.node)) {
      // (its frame, outside what it draws: the space around it)
      if (n === target && (n as HTMLElement).classList.contains("react-renderer")) continue;
      return null;
    }
    const el = desc.contentDOM instanceof HTMLElement ? desc.contentDOM : (n as HTMLElement);
    return { node: desc.node, start: desc.posBefore + 1, el };
  }
  return null;
}

const frameOf = (dom: HTMLElement): DOMRect => (dom.querySelector(":scope > [data-node-view-wrapper]") ?? dom).getBoundingClientRect();

/**
 * The gap a click at (x, y) on `target` means, at any depth: between two blocks of a column (or of the page) by its height, between
 * two columns of a row by its side — below a shorter column, the end of that column.
 */
export function gapIn(view: EditorView, target: HTMLElement, x: number, y: number): { pos: number; before: PmNode | null; after: PmNode | null } | null {
  const c = containerAt(view, target);
  if (!c) return null;
  const style = getComputedStyle(c.el);
  const row = style.display.includes("flex") && style.flexDirection.startsWith("row");
  let pos = c.start;
  let prev: PmNode | null = null;
  let prevEnd: number | null = null;
  for (let i = 0; i < c.node.childCount; i++) {
    const child = c.node.child(i);
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      const r = frameOf(dom);
      const [lo, hi, at] = row ? [r.left, r.right, x] : [r.top, r.bottom, y];
      if (at < lo) return prevEnd === null || at >= prevEnd - 1 ? { pos, before: prev, after: child } : null;
      if (at <= hi) {
        // Beside a column that ends higher up: the end of that column.
        if (row && !child.isTextblock && !child.isAtom && child.childCount && y > r.bottom) return { pos: pos + child.nodeSize - 1, before: child.lastChild, after: null };
        return null;
      }
      prevEnd = hi;
    }
    prev = child;
    pos += child.nodeSize;
  }
  return prevEnd !== null ? { pos, before: prev, after: null } : null;
}

/** Each object block inside a selection over text and blocks, marked (they can't show the browser's selection themselves). */
function rangeDecorations(state: EditorState): DecorationSet {
  const sel = state.selection;
  if (sel.empty || sel instanceof NodeSelection) return DecorationSet.empty;
  const decos: Decoration[] = [];
  state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
    if (isObjectBlock(node) && pos >= sel.from && pos + node.nodeSize <= sel.to) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "ws-block-in-sel" }));
      return false;
    }
    return true;
  });
  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

/** The picked object block (a NodeSelection on one), or null. */
export function pickedBlock(state: EditorState): { pos: number; node: PmNode } | null {
  const sel = state.selection;
  return sel instanceof NodeSelection && isObjectBlock(sel.node) ? { pos: sel.from, node: sel.node } : null;
}

/** The picked block doubled: the copy right below it, picked. */
export function duplicateBlock(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const at = pos + node.nodeSize;
  const tr = view.state.tr.insert(at, node.copy(node.content));
  tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

/** The block moved one place up or down among its siblings (it stays picked). */
export function moveBlock(view: EditorView, pos: number, dir: -1 | 1): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const sibIndex = index + dir;
  if (sibIndex < 0 || sibIndex >= parent.childCount) return false;
  const sib = parent.child(sibIndex);
  let tr: Transaction = state.tr.delete(pos, pos + node.nodeSize);
  const target = dir < 0 ? pos - sib.nodeSize : pos + sib.nodeSize;
  tr = tr.insert(target, node);
  tr.setSelection(NodeSelection.create(tr.doc, target)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

/** The block taken out; the cursor goes where it was (onto the next line, else a gap). */
export function removeBlock(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = view.state.tr.delete(pos, pos + node.nodeSize);
  const $at = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
  tr.setSelection(gapValid($at) ? new GapCursor($at) : TextSelection.near($at));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** A new empty line at `pos` (a gap between blocks), the cursor in it. */
export function lineAt(view: EditorView, pos: number): boolean {
  const para = view.state.schema.nodes.paragraph;
  if (!para) return false;
  const tr = view.state.tr.insert(pos, para.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * A click in the page's own space (between blocks, not on one): the cursor goes to the gap there — when a block that holds no text
 * is on either side (between two lines of text the browser places it as always); true: the click is taken. A click on such a block
 * (not on a link, a button or a field in it): the block is picked.
 */
function pickOrGap(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable || event.button !== 0 || event.shiftKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  // (the space of the page or of a box of blocks — a row, a column — or the outer edge of a block's frame, outside what it draws)
  const gap = target.closest(INTERACTIVE) ? null : gapIn(view, target, event.clientX, event.clientY);
  if (!gap) {
    // A click on a block that holds no text (not on a link, a button or a field in it, nor inside a part of it that takes clicks
    // itself — [data-no-pick], e.g. the visual editor's canvas): the block is picked. (The browser is kept from putting its own
    // caret into the block's text — it would take the pick back; the click still reaches the block.)
    const b = blockAt(view, target);
    if (!b || interactiveIn(b.el, target)) return false;
    event.preventDefault();
    if (!(view.state.selection instanceof NodeSelection && view.state.selection.from === b.pos)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, b.pos)));
    view.focus();
    return false;
  }
  if (!(isNonTextBlock(gap.before) || isNonTextBlock(gap.after))) return false;
  const $pos = view.state.doc.resolve(gap.pos);
  // Next to a line of text the cursor goes into that line (its start below, its end above); between blocks into the gap.
  const sel = gapValid($pos)
    ? new GapCursor($pos)
    : gap.after?.isTextblock
      ? TextSelection.create(view.state.doc, gap.pos + 1)
      : gap.before?.isTextblock
        ? TextSelection.create(view.state.doc, gap.pos - 1)
        : null;
  if (!sel) return false;
  view.dispatch(view.state.tr.setSelection(sel));
  view.focus();
  return true;
}

export const BlockSelect = Extension.create({
  name: "blockSelect",
  addKeyboardShortcuts() {
    const view = () => this.editor.view;
    return {
      // At the cursor between blocks: a new line there.
      Enter: () => {
        const sel = this.editor.state.selection;
        return sel instanceof GapCursor ? lineAt(view(), sel.from) : false;
      },
      "Mod-d": () => {
        const p = pickedBlock(this.editor.state);
        return p ? duplicateBlock(view(), p.pos) : false;
      },
      "Alt-ArrowUp": () => {
        const p = pickedBlock(this.editor.state);
        return p ? moveBlock(view(), p.pos, -1) : false;
      },
      "Alt-ArrowDown": () => {
        const p = pickedBlock(this.editor.state);
        return p ? moveBlock(view(), p.pos, 1) : false;
      },
      // Let go of a picked block: the cursor right after it.
      Escape: () => {
        const p = pickedBlock(this.editor.state);
        if (!p) return false;
        const { state } = this.editor;
        const $after = state.doc.resolve(p.pos + p.node.nodeSize);
        view().dispatch(state.tr.setSelection(gapValid($after) ? new GapCursor($after) : TextSelection.near($after)));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockSelectKey,
        props: {
          decorations: (state) => rangeDecorations(state),
          // ProseMirror's own click (on mouseup) would put the caret at the nearest line: on such a block it picks the block.
          handleClick: (view, _pos, event) => {
            const target = event.target as HTMLElement | null;
            if (!view.editable || !target) return false;
            const b = blockAt(view, target);
            if (!b || interactiveIn(b.el, target)) return false;
            if (!(view.state.selection instanceof NodeSelection && view.state.selection.from === b.pos)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, b.pos)));
            return true;
          },
        },
        // (A listener of its own, in the capture phase: other plugins' mousedown handlers that answer first would hide the click.)
        view: (view) => {
          const down = (event: MouseEvent): void => {
            if (pickOrGap(view, event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          };
          view.dom.addEventListener("mousedown", down, true);
          return { destroy: () => view.dom.removeEventListener("mousedown", down, true) };
        },
      }),
    ];
  },
});
