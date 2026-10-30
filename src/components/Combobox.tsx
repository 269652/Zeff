"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/** The keys of a field with a list under it (a combobox): what `useComboboxKeys` needs. */
export type ComboboxKeysOptions = {
  /** How many options the list shows. */
  count: number;
  /** Whether the list is shown. */
  open: boolean;
  /** Show or hide the list (ArrowDown shows it, Escape hides it). */
  setOpen?: (open: boolean) => void;
  /** The option at this index was chosen (Enter, or Tab with `tab`). */
  onPick: (index: number) => void;
  /** ↑ on the first goes to the last and ↓ on the last to the first (default: they stop there). */
  wrap?: boolean;
  /** Tab picks too (a field you type into quickly: a name, a tag). */
  tab?: boolean;
  /** The index nothing typed starts at: -1 (nothing chosen, Enter submits the form) or 0 (the first). Default -1. */
  start?: number;
  /** With the list hidden (or empty) the keys are the field's own — a text area's caret moves (default: ↓ shows the list). */
  ignoreClosed?: boolean;
  /** Escape did more than hide the list (what was typed goes back). */
  onEscape?: () => void;
};

/**
 * Arrow keys, Enter (Tab), Escape and the active option of a combobox, with the ids the field and its list need for
 * aria-controls and aria-activedescendant: `listId` on the list, `optionId(i)` on each option, `activeDescendant` on the field.
 */
export function useComboboxKeys({ count, open, setOpen, onPick, wrap = false, tab = false, start = -1, ignoreClosed = false, onEscape }: ComboboxKeysOptions) {
  const listId = useId();
  const [active, setActive] = useState(start);
  const n = Math.max(1, count);
  const optionId = (i: number) => `${listId}-${i}`;
  const onKeyDown = (e: KeyboardEvent) => {
    if (ignoreClosed && (!open || !count)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen?.(true);
      setActive((a) => (wrap ? (a + 1) % n : Math.min(a + 1, count - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (wrap ? (a - 1 + n) % n : Math.max(a - 1, 0)));
    } else if ((e.key === "Enter" || (tab && e.key === "Tab")) && open && active >= 0 && active < count) {
      e.preventDefault();
      onPick(active);
    } else if (e.key === "Escape") {
      setOpen?.(false);
      onEscape?.();
    }
  };
  return {
    active,
    setActive,
    /** Back to the start (what is typed changed). */
    reset: () => setActive(start),
    onKeyDown,
    listId,
    optionId,
    activeDescendant: open && active >= 0 && active < count ? optionId(active) : undefined,
  };
}

/**
 * An async search whose answers can come back out of order: only the latest `search(q)` sets `result` (and calls `onResult`).
 * `delay` waits that long after the last call first (typing); `busy` while the latest is asked.
 */
export function useLatestSearch<R>(fn: (q: string) => Promise<R>, initial: R, { delay = 0, onResult }: { delay?: number; onResult?: (r: R) => void } = {}) {
  const [result, setResult] = useState<R>(initial);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ fn, onResult });
  useEffect(() => {
    latest.current = { fn, onResult };
  });
  useEffect(
    () => () => {
      seq.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const ask = (q: string, n: number) => {
    setBusy(true);
    latest.current.fn(q).then(
      (r) => {
        if (n !== seq.current) return;
        setBusy(false);
        setResult(r);
        latest.current.onResult?.(r);
      },
      () => n === seq.current && setBusy(false),
    );
  };
  const search = (q: string) => {
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    if (delay > 0) timer.current = setTimeout(() => ask(q, n), delay);
    else ask(q, n);
  };
  return {
    result,
    setResult,
    search,
    busy,
    /** Answers still on their way are dropped. */
    cancel: () => {
      seq.current++;
      if (timer.current) clearTimeout(timer.current);
      setBusy(false);
    },
  };
}
