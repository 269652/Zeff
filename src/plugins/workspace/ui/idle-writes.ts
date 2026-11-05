"use client";

import { useEffect, useRef, useState } from "react";

export type HeldEdits = Record<string, Record<string, unknown>>;

/** How long nothing has to happen before what was changed is written. */
export const IDLE_MS = 800;

type Write = (rowId: number, propId: string, value: unknown) => void;

/**
 * Edits held back until you stop: a date stepped down with the arrow keys is one write, of where it ended, and nothing comes back
 * from the server while you are at it. Any further edit starts the wait again. What is held is shown instead of the row's value.
 */
export class IdleWrites {
  private held = new Map<string, { rowId: number; propId: string; value: unknown }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private write: Write,
    private changed: (edits: HeldEdits) => void,
    private delay = IDLE_MS,
  ) {}

  private show() {
    const edits: HeldEdits = {};
    for (const { rowId, propId, value } of this.held.values()) (edits[rowId] ??= {})[propId] = value;
    this.changed(edits);
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  hold(rowId: number, propId: string, value: unknown) {
    this.held.set(`${rowId}:${propId}`, { rowId, propId, value });
    this.show();
    this.stop();
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** Taken back: it isn't written (a time of a tick that just went off). */
  drop(rowId: number, propId: string) {
    if (this.held.delete(`${rowId}:${propId}`)) this.show();
    if (!this.held.size) this.stop();
  }

  /** Everything held, written now. */
  flush() {
    this.stop();
    if (!this.held.size) return;
    const all = [...this.held.values()];
    this.held.clear();
    for (const e of all) this.write(e.rowId, e.propId, e.value);
    this.show();
  }
}

/** `IdleWrites` for a component: what is held, to show; written at the latest when it goes away or the page is left. */
export function useIdleWrites(write: Write, delay = IDLE_MS): { edits: HeldEdits; writes: IdleWrites } {
  const latest = useRef(write);
  useEffect(() => {
    latest.current = write;
  }, [write]);
  const [edits, setEdits] = useState<HeldEdits>({});
  const [writes] = useState(() => new IdleWrites((rowId, propId, value) => latest.current(rowId, propId, value), setEdits, delay));
  useEffect(() => {
    const leave = () => {
      if (document.visibilityState === "hidden") writes.flush();
    };
    document.addEventListener("visibilitychange", leave);
    return () => {
      document.removeEventListener("visibilitychange", leave);
      writes.flush();
    };
  }, [writes]);
  return { edits, writes };
}
