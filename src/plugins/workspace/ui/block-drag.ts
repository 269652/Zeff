import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { blockAt, interactiveIn } from "./block-select";

/**
 * A block that holds no text (a widget, a block of your own, a view …) moved by taking hold of the block itself — no handle needed:
 * with the mouse, press on it and move; with a finger or a pen, hold it a moment (it lifts), then move. A line shows where it will
 * land — between blocks, or beside them in a row of a flex box; letting go puts it there (Escape: back where it was). Near the top or
 * bottom of the window the page scrolls along.
 */

const HOLD_MS = 350; // a finger: how long to hold before the block lifts
const MOUSE_START = 5; // the mouse: how far to move (px) before it is a drag, not a click
const TOUCH_SLOP = 8; // a finger moving more than this before the hold is up: it scrolls, no drag
const EDGE = 64; // px from the window's top / bottom where the page scrolls along

type Drop = { pos: number; line: { left: number; top: number; width: number; height: number } };

/** The nearest scrolling box around the page (else the window). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Where `node` would land for the pointer at (x, y): before or after the innermost block there whose container can take it. */
function dropAt(view: EditorView, x: number, y: number, from: number, node: PmNode): Drop | null {
  const box = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: Math.min(Math.max(x, box.left + 2), box.right - 2), top: Math.min(Math.max(y, box.top + 1), box.bottom - 1) });
  if (!hit) return null;
  const doc = view.state.doc;
  const to = from + node.nodeSize;
  const candidates: { pos: number; node: PmNode }[] = [];
  const inner = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
  if (inner?.isBlock) candidates.push({ pos: hit.inside, node: inner });
  const $p = doc.resolve(hit.pos);
  for (let d = $p.depth; d >= 1; d--) candidates.push({ pos: $p.before(d), node: $p.node(d) });
  for (const c of candidates) {
    // (not into itself)
    if (c.pos >= from && c.pos < to && c.pos !== from) continue;
    const $c = doc.resolve(c.pos);
    const parent = $c.parent;
    if (!parent.canReplaceWith($c.index(), $c.index(), node.type)) continue;
    const dom = view.nodeDOM(c.pos);
    if (!(dom instanceof HTMLElement)) continue;
    const r = (dom.querySelector(":scope > [data-node-view-wrapper]") ?? dom).getBoundingClientRect();
    const row = parent.type.name === "flexBox" && parent.attrs.dir === "row";
    const after = row ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    const pos = after ? c.pos + c.node.nodeSize : c.pos;
    if (pos === from || pos === to) return { pos: -1, line: { left: 0, top: 0, width: 0, height: 0 } };
    const line = row ? { left: after ? r.right + 4 : r.left - 6, top: r.top, width: 2, height: r.height } : { left: r.left, top: after ? r.bottom + 3 : r.top - 5, width: r.width, height: 2 };
    return { pos, line };
  }
  return null;
}

export const BlockDrag = Extension.create({
  name: "blockDrag",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("wsBlockDrag"),
        view: (view) => {
          let pending: { pointer: number; x: number; y: number; pos: number; node: PmNode; el: HTMLElement; touch: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
          let drag: { pos: number; node: PmNode; el: HTMLElement; drop: Drop | null; x: number; y: number; frame: number } | null = null;
          let line: HTMLDivElement | null = null;

          const showLine = (d: Drop | null) => {
            const host = view.dom.closest<HTMLElement>(".ws-editor") ?? view.dom.parentElement;
            if (!host) return;
            if (!line) {
              line = document.createElement("div");
              line.className = "ws-drop-line";
              host.appendChild(line);
            }
            if (!d || d.pos < 0) return void (line.style.display = "none");
            const h = host.getBoundingClientRect();
            Object.assign(line.style, { display: "block", left: `${d.line.left - h.left}px`, top: `${d.line.top - h.top}px`, width: `${d.line.width}px`, height: `${d.line.height}px` });
          };

          const lift = () => {
            if (!pending) return;
            if (pending.timer) clearTimeout(pending.timer);
            const { pos, node, el, x, y } = pending;
            pending = null;
            drag = { pos, node, el, drop: null, x, y, frame: 0 };
            el.classList.add("ws-block-lifted");
            document.body.classList.add("ws-dragging-block");
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            navigator.vibrate?.(15);
            const scroller = scrollerOf(view.dom);
            // Near the window's edges the page scrolls along (and the drop line follows).
            const tick = () => {
              if (!drag) return;
              const dy = drag.y < EDGE ? -Math.ceil((EDGE - drag.y) / 4) : drag.y > window.innerHeight - EDGE ? Math.ceil((drag.y - (window.innerHeight - EDGE)) / 4) : 0;
              if (dy) {
                if (scroller) scroller.scrollTop += dy;
                else window.scrollBy(0, dy);
                drag.drop = dropAt(view, drag.x, drag.y, drag.pos, drag.node);
                showLine(drag.drop);
              }
              drag.frame = requestAnimationFrame(tick);
            };
            drag.frame = requestAnimationFrame(tick);
            move(x, y);
          };

          const move = (x: number, y: number) => {
            if (!drag) return;
            drag.x = x;
            drag.y = y;
            drag.drop = dropAt(view, x, y, drag.pos, drag.node);
            showLine(drag.drop);
          };

          const end = (commit: boolean) => {
            if (pending?.timer) clearTimeout(pending.timer);
            pending = null;
            if (!drag) return;
            const { pos, node, el, drop, frame } = drag;
            drag = null;
            cancelAnimationFrame(frame);
            el.classList.remove("ws-block-lifted");
            document.body.classList.remove("ws-dragging-block");
            showLine(null);
            if (!commit || !drop || drop.pos < 0 || view.state.doc.nodeAt(pos) !== node) return;
            const tr = view.state.tr.delete(pos, pos + node.nodeSize);
            const at = tr.mapping.map(drop.pos);
            tr.insert(at, node);
            tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
            view.dispatch(tr);
            view.focus();
          };

          const down = (e: PointerEvent) => {
            if (!view.editable || e.button !== 0 || e.shiftKey || drag) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const b = blockAt(view, target);
            if (!b || interactiveIn(b.el, target)) return;
            const touch = e.pointerType !== "mouse";
            pending = { pointer: e.pointerId, x: e.clientX, y: e.clientY, pos: b.pos, node: b.node, el: b.el, touch, timer: touch ? setTimeout(lift, HOLD_MS) : null };
          };
          const pmove = (e: PointerEvent) => {
            if (drag) {
              e.preventDefault();
              return move(e.clientX, e.clientY);
            }
            if (!pending || e.pointerId !== pending.pointer) return;
            const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
            if (pending.touch) {
              // A finger that moves before the hold is up scrolls the page.
              if (dist > TOUCH_SLOP) end(false);
            } else if (dist > MOUSE_START) {
              pending.x = e.clientX;
              pending.y = e.clientY;
              lift();
            }
          };
          const up = () => end(true);
          const cancel = () => end(false);
          const key = (e: KeyboardEvent) => {
            if (drag && e.key === "Escape") {
              e.preventDefault();
              end(false);
            }
          };
          // While a finger drags, the page must not scroll under it (and no long-press menu pops up).
          const touchmove = (e: TouchEvent) => {
            if (drag) e.preventDefault();
          };
          const menu = (e: Event) => {
            if (drag || pending?.touch) e.preventDefault();
          };

          view.dom.addEventListener("pointerdown", down, true);
          view.dom.addEventListener("contextmenu", menu);
          document.addEventListener("pointermove", pmove, { passive: false });
          document.addEventListener("pointerup", up);
          document.addEventListener("pointercancel", cancel);
          document.addEventListener("keydown", key, true);
          document.addEventListener("touchmove", touchmove, { passive: false });
          return {
            destroy: () => {
              end(false);
              line?.remove();
              view.dom.removeEventListener("pointerdown", down, true);
              view.dom.removeEventListener("contextmenu", menu);
              document.removeEventListener("pointermove", pmove);
              document.removeEventListener("pointerup", up);
              document.removeEventListener("pointercancel", cancel);
              document.removeEventListener("keydown", key, true);
              document.removeEventListener("touchmove", touchmove);
            },
          };
        },
      }),
    ];
  },
});
