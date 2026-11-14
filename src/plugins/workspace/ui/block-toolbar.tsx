"use client";

import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/components/I18nProvider";
import { blockAt, duplicateBlock, gapAt, isNonTextBlock, isObjectBlock, lineAt, moveBlock, pickedBlock, removeBlock } from "./block-select";

/**
 * The bar above a block that holds no text (a widget, a block of your own, a view …): shown when the pointer is over it or it is
 * picked. What the block itself offers comes first (Edit, Settings, Improve with AI, Read again — declared by the block with useBlockActions),
 * then what every block can: double it, move it up or down, take it out. Between such blocks a line with ＋ shows where a new
 * line can go.
 */

export type BlockAction = "edit" | "code" | "settings" | "ai" | "reload";
const EVENT = "ws-block-action";
const CHANGED = "ws-block-changed";

/**
 * What a block's node view offers the bar: spread the result on its NodeViewWrapper. `labels` names an action the block's own
 * way ("Edit visually", "Open in Studio").
 */
export function useBlockActions(handlers: Partial<Record<BlockAction, () => void>>, labels: Partial<Record<BlockAction, string>> = {}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const on = (e: Event) => latest.current[(e as CustomEvent<BlockAction>).detail]?.();
    el.addEventListener(EVENT, on);
    return () => el.removeEventListener(EVENT, on);
  }, [el]);
  const keys = (Object.keys(handlers) as BlockAction[]).filter((k) => handlers[k]);
  const offered = keys.join(" ");
  // What it offers changed (it loaded, it left a mode): the bar over it reads it again.
  useEffect(() => {
    el?.dispatchEvent(new Event(CHANGED, { bubbles: true }));
  }, [el, offered]);
  return {
    ref: setEl,
    "data-block-actions": offered,
    ...Object.fromEntries(Object.entries(labels).map(([k, v]) => [`data-block-label-${k}`, v])),
  };
}

type Shown = { pos: number; top: number; left: number; width: number; height: number; actions: BlockAction[]; labels: Partial<Record<BlockAction, string>>; first: boolean; last: boolean; picked: boolean };
type Gap = { pos: number; y: number; left: number; width: number };

/** Where the block at `pos` stands in `root`, and what its bar offers. */
function measure(root: HTMLElement, view: EditorView, pos: number, picked: boolean): Shown | null {
  const node = view.state.doc.nodeAt(pos);
  const el = view.nodeDOM(pos);
  if (!isObjectBlock(node) || !(el instanceof HTMLElement) || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const c = root.getBoundingClientRect();
  const wrap = el.matches("[data-node-view-wrapper]") ? el : el.querySelector<HTMLElement>("[data-node-view-wrapper]");
  const actions = (wrap?.dataset.blockActions ?? "").split(" ").filter(Boolean) as BlockAction[];
  const labels: Partial<Record<BlockAction, string>> = {};
  for (const a of actions) {
    const l = wrap?.getAttribute(`data-block-label-${a}`);
    if (l) labels[a] = l;
  }
  const $pos = view.state.doc.resolve(pos);
  return { pos, top: r.top - c.top, left: r.left - c.left, width: r.width, height: r.height, actions, labels, first: $pos.index() === 0, last: $pos.index() === $pos.parent.childCount - 1, picked };
}

export function BlockToolbar({ editor, box }: { editor: Editor; box: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const hoverEl = useRef<HTMLElement | null>(null);

  // The bar follows the block under the pointer, else the picked one; the line with ＋ the gap under the pointer.
  // (Measured in the listeners — the editor's changes and the pointer's moves — not while drawing.)
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const view = editor.view;
    const update = () => {
      if (editor.isDestroyed) return;
      const h = hoverEl.current?.isConnected ? blockAt(view, hoverEl.current) : null;
      // (picked shows only while the page is being edited — not the selection a page opens with)
      const p = view.hasFocus() ? pickedBlock(view.state) : null;
      setShown(h ? measure(root, view, h.pos, h.pos === p?.pos) : p ? measure(root, view, p.pos, true) : null);
    };
    // Off a block, the bar stays a moment (the way up to it crosses the gap above the block, or a corner of the next one).
    let letGo: ReturnType<typeof setTimeout> | null = null;
    const hold = () => {
      if (letGo) clearTimeout(letGo);
      letGo = null;
    };
    const release = () => {
      if (letGo || !hoverEl.current) return;
      letGo = setTimeout(() => {
        letGo = null;
        hoverEl.current = null;
        update();
      }, 350);
    };
    const move = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".ws-block-bar, .ws-gap-add")) return hold();
      if (!view.dom.contains(target)) {
        setGap(null);
        return release();
      }
      const b = blockAt(view, target);
      if (b) {
        hold();
        hoverEl.current = b.el;
      } else release();
      const onPage = target === view.dom || (target.parentElement === view.dom && target.classList.contains("react-renderer"));
      const g = !b || onPage ? gapAt(view, e.clientY) : null;
      if (g && (isNonTextBlock(g.before) || isNonTextBlock(g.after))) {
        const c = root.getBoundingClientRect();
        const d = view.dom.getBoundingClientRect();
        setGap({ pos: g.pos, y: g.y - c.top, left: d.left - c.left, width: d.width });
      } else setGap(null);
      update();
    };
    const leave = () => {
      setGap(null);
      release();
    };
    update();
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", update);
    root.addEventListener(CHANGED, update);
    root.addEventListener("mousemove", move);
    root.addEventListener("mouseleave", leave);
    return () => {
      hold();
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", update);
      root.removeEventListener(CHANGED, update);
      root.removeEventListener("mousemove", move);
      root.removeEventListener("mouseleave", leave);
    };
  }, [editor, box]);

  if (!editor.isEditable) return null;
  const view = editor.view;
  const run = (a: BlockAction, pos: number) => {
    const el = view.nodeDOM(pos);
    const wrap = el instanceof HTMLElement ? (el.matches("[data-node-view-wrapper]") ? el : el.querySelector("[data-node-view-wrapper]")) : null;
    wrap?.dispatchEvent(new CustomEvent(EVENT, { detail: a }));
  };
  const NAMES: Record<BlockAction, [string, string]> = {
    edit: ["✎", t("Edit")],
    settings: ["⚙", t("Settings")],
    ai: ["✨", t("Improve with AI")],
    reload: ["↻", t("Read again")],
    code: ["</>", t("Code — see and change how it is made")],
  };
  const btn = "grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white";
  return (
    <>
      {shown && !shown.picked && <div className="ws-block-hover" style={{ top: shown.top, left: shown.left, width: shown.width, height: shown.height }} aria-hidden />}
      {shown && (
        <div
          className="ws-block-bar"
          role="toolbar"
          aria-label={t("Block")}
          style={{ top: shown.top, left: shown.left + shown.width }}
          data-picked={shown.picked}
          // (the editor keeps its selection while the bar is used)
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.actions.map((a) => (
            <button key={a} type="button" className={`${btn} ${a === "edit" ? "gap-1 font-medium text-indigo-700 dark:text-indigo-300" : ""}`} title={shown.labels[a] ?? NAMES[a][1]} aria-label={shown.labels[a] ?? NAMES[a][1]} onClick={() => run(a, shown.pos)}>
              {a === "edit" ? (
                <span className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <span aria-hidden>{NAMES.edit[0]}</span>
                  {shown.labels.edit ?? NAMES.edit[1]}
                </span>
              ) : (
                <span aria-hidden className={a === "code" ? "font-mono text-[11px] font-semibold" : undefined}>
                  {NAMES[a][0]}
                </span>
              )}
            </button>
          ))}
          {shown.actions.length > 0 && <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />}
          <button type="button" className={btn} title={`${t("Duplicate")} (Ctrl+D)`} aria-label={t("Duplicate")} onClick={() => duplicateBlock(view, shown.pos)}>
            <span aria-hidden>⧉</span>
          </button>
          <button type="button" className={btn} disabled={shown.first} title={`${t("Move up")} (Alt+↑)`} aria-label={t("Move up")} onClick={() => moveBlock(view, shown.pos, -1)}>
            <span aria-hidden>↑</span>
          </button>
          <button type="button" className={btn} disabled={shown.last} title={`${t("Move down")} (Alt+↓)`} aria-label={t("Move down")} onClick={() => moveBlock(view, shown.pos, 1)}>
            <span aria-hidden>↓</span>
          </button>
          <button
            type="button"
            className={`${btn} hover:!bg-red-50 hover:!text-red-700 dark:hover:!bg-red-950/50 dark:hover:!text-red-300`}
            title={`${t("Remove this block")} (Del)`}
            aria-label={t("Remove this block")}
            onClick={() => {
              hoverEl.current = null;
              removeBlock(view, shown.pos);
            }}
          >
            <span aria-hidden>🗑</span>
          </button>
        </div>
      )}
      {gap && (
        <div className="ws-gap-add" style={{ top: gap.y, left: gap.left, width: gap.width }}>
          <button
            type="button"
            title={t("A new line here")}
            aria-label={t("A new line here")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setGap(null);
              lineAt(view, gap.pos);
            }}
          >
            ＋
          </button>
        </div>
      )}
    </>
  );
}
