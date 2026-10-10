"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { CalendarIcon } from "../icons";

/** A calendar icon that opens the browser's date picker — the recap of the day picked is shown. */
export function RecapDayPicker({ day, max }: { day: string; max: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="icon-btn"
        onClick={() => {
          const el = input.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        title="Jump to a day"
        aria-label="Jump to a day"
      >
        <CalendarIcon />
      </button>
      <input
        ref={input}
        type="date"
        key={day}
        defaultValue={day}
        max={max}
        onChange={(e) => e.target.value && router.push(`/todos?view=recap&day=${e.target.value}`)}
        className="pointer-events-none absolute inset-0 opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </span>
  );
}
