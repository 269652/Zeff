"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";

/** Where a dragged row would land: before or after the row it's over. */
export type DropAt = "before" | "after" | null;

/** What a reorderable row needs: its grip's props, its own props, where a drop would land, whether it's the one dragged. */
export type ReorderRow = {
  grip: {
    draggable: boolean;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  row: { "data-reorder-row": string; onDragOver: (e: DragEvent<HTMLElement>) => void; onDrop: (e: DragEvent<HTMLElement>) => void };
  dropAt: DropAt;
  dragging: boolean;
};

/**
 * Reordering a list by drag and drop (the browser's own): a row is dragged by its grip and
 * dropped on another — before or after it, by which half the pointer is over — or moved with
 * ↑/↓ while its grip has focus. `onReorder` gets the ids in their new order.
 */
export function useReorder<T extends string | number>(ids: T[], onReorder: (next: T[]) => void) {
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<{ id: T; after: boolean } | null>(null);
  const end = () => {
    setDragging(null);
    setOver(null);
  };
  const move = (next: T[]) => {
    if (next.some((x, i) => x !== ids[i])) onReorder(next);
  };
  const dropAt = (id: T): DropAt => (over && over.id === id && dragging !== null && dragging !== id ? (over.after ? "after" : "before") : null);
  const grip = (id: T): ReorderRow["grip"] => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      setDragging(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
      // Drag the whole row, not just the grip.
      const r = e.currentTarget.closest("[data-reorder-row]");
      if (r instanceof HTMLElement) e.dataTransfer.setDragImage(r, 12, Math.min(r.offsetHeight / 2, 16));
    },
    onDragEnd: end,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const i = ids.indexOf(id);
      const j = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const next = [...ids];
      [next[i], next[j]] = [next[j], next[i]];
      move(next);
    },
  });
  const row = (id: T): ReorderRow["row"] => ({
    "data-reorder-row": "",
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.id !== id || over.after !== after) setOver({ id, after });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragging === null || !over || over.id === dragging) return end();
      const next = ids.filter((x) => x !== dragging);
      next.splice(next.indexOf(over.id) + (over.after ? 1 : 0), 0, dragging);
      end();
      move(next);
    },
  });
  /** All a row needs, for the row with this id. */
  const rowFor = (id: T): ReorderRow => ({ grip: grip(id), row: row(id), dropAt: dropAt(id), dragging: dragging === id });
  return { dragging, rowFor };
}

/** A row's drop line (where the dragged one would land) and the dragged one faded — as classes. */
export const reorderClasses = (r?: ReorderRow) =>
  !r
    ? ""
    : `${r.dragging ? "opacity-40" : ""} ${r.dropAt === "before" ? "shadow-[inset_0_2px_0_0_var(--color-indigo-500)]" : r.dropAt === "after" ? "shadow-[inset_0_-2px_0_0_var(--color-indigo-500)]" : ""}`;
