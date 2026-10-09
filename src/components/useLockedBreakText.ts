"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { initBreakEdit, lockBreakEdit } from "@/lib/pauses-shared";

/**
 * A break text field ("12:00-13:00, 15:00-15:15") where changing a start or an end moves
 * the break and keeps its length — the other time is rewritten in the text (see
 * lockBreakEdit). Pass the <input>'s ref (to keep the caret in place); bind `text` and
 * `onChange`; `reset` replaces the text (e.g. when an editor opens) and compares from there.
 */
export function useLockedBreakText(initial: string, defaultStart: string, inputRef: RefObject<HTMLInputElement | null>) {
  const [s, setS] = useState(() => ({ text: initial, edit: initBreakEdit(initial, defaultStart) }));
  const caret = useRef<number | null>(null);

  // Put the caret back where it was when a time before it got rewritten.
  useLayoutEffect(() => {
    if (caret.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const typed = e.target.value;
    const r = lockBreakEdit(s.edit, typed, e.target.selectionStart ?? typed.length, defaultStart);
    if (r.text !== typed) caret.current = r.caret;
    setS({ text: r.text, edit: r.state });
  }

  function reset(text: string) {
    setS({ text, edit: initBreakEdit(text, defaultStart) });
  }

  return { text: s.text, onChange, reset };
}
