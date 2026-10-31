"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { plausibleDate } from "@/lib/todos/due-shared";

/**
 * A date field that saves what you meant, not every key: a day picked in the browser's calendar is saved at once; one typed is saved
 * on Enter or when you leave the field — typing "15" into a date that was there makes "02.11." on the first key, a whole date the
 * field would have saved and closed on. Only a whole date of a sensible year is saved (not "0002-11-15" while a year is typed);
 * emptied, it saves none. Escape: back to what was there (`onCancel`).
 */
export function DateField({
  value,
  onCommit,
  onCancel,
  ...rest
}: { value: string | null | undefined; onCommit: (v: string | null) => void; onCancel?: () => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type">) {
  const [draft, setDraft] = useState(value ?? "");
  const [from, setFrom] = useState(value);
  if (from !== value) {
    setFrom(value);
    setDraft(value ?? "");
  }
  // A key pressed since the field got the focus: typing — saved on Enter or leaving, not on each key.
  const typing = useRef(false);
  const commit = (v: string) => {
    typing.current = false;
    if ((v || null) === (value || null)) return;
    if (!v) onCommit(null);
    else if (plausibleDate(v)) onCommit(v);
  };
  return (
    <input
      {...rest}
      type="date"
      value={draft}
      onFocus={(e) => {
        typing.current = false;
        rest.onFocus?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          typing.current = false;
          setDraft(value ?? "");
          onCancel?.();
        } else if (e.key !== "Tab") typing.current = true;
        rest.onKeyDown?.(e);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        // (Picked in the calendar — no key pressed: saved at once.)
        if (!typing.current) commit(e.target.value);
      }}
      onBlur={(e) => {
        if (typing.current) commit(e.target.value);
        rest.onBlur?.(e);
      }}
    />
  );
}
