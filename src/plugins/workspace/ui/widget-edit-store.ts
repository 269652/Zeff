"use client";

import { useSyncExternalStore } from "react";
import type { DropAt, VisualModel } from "@/lib/widgets/visual";

/**
 * What the visual widget editor shares with the Workspace sidebar: while a widget is edited the sidebar shows its outline and the
 * properties of what is picked instead of the page tree; saving or cancelling ends the session and the tree is back. One session
 * at a time (the one that started last wins).
 */

export type EditSession = {
  id: string;
  /** The page the widget stands on (what its widgets share is kept by it). */
  pageId: number | null;
  title: string;
  model: VisualModel;
  /** Save (the editor writes the markup into the block) and leave. */
  onSave: () => void;
  onCancel: () => void;
};
/** `selected`: the one the properties are of (the last picked); `multi`: all picked (shift-click adds). */
type Snapshot = { session: EditSession | null; selected: string | null; multi: string[]; tick: number };

let snap: Snapshot = { session: null, selected: null, multi: [], tick: 0 };
let unsubscribeModel: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = (next: Partial<Snapshot>) => {
  snap = { ...snap, ...next, tick: snap.tick + 1 };
  for (const l of listeners) l();
};

export function startEdit(session: EditSession): void {
  unsubscribeModel?.();
  unsubscribeModel = session.model.subscribe(() => emit({}));
  emit({ session, selected: null, multi: [] });
}
export function stopEdit(id?: string): void {
  if (id && snap.session?.id !== id) return;
  unsubscribeModel?.();
  unsubscribeModel = null;
  emit({ session: null, selected: null, multi: [] });
}
export function select(zid: string | null, add = false): void {
  const multi = zid === null ? [] : add ? (snap.multi.includes(zid) ? snap.multi.filter((x) => x !== zid) : [...snap.multi, zid]) : [zid];
  emit({ selected: multi.length ? multi[multi.length - 1] : null, multi });
}

/** The last message sent under each name, by page (zeff.emit) — a widget that loads later asks for it (bus.last); the editor shows it. */
export const lastSaid = new Map<string, unknown>();
export const saidKey = (page: number, name: string) => `${page}:${name}`;

/** What is being dragged (from the outline, the canvas or the palette) — read by whichever it is dropped on. */
export type Dragged = { kind: "move"; zid: string } | { kind: "new"; element: string };
let dragged: Dragged | null = null;
export const setDragged = (d: Dragged | null) => void (dragged = d);
export const getDragged = () => dragged;
/** The drop itself: a moved element or a new one put at `target`. */
export function dropOn(target: string, at: DropAt): void {
  const s = snap.session;
  const d = dragged;
  dragged = null;
  if (!s || !d) return;
  if (d.kind === "move") s.model.move(d.zid, target, at);
  else select(s.model.insert(d.element, target, at));
}

const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
export function useEditSession(): Snapshot {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}
