"use client";

import { useOptimistic, useState, useTransition } from "react";
import { updateEntryHoursAction } from "@/app/actions";
import { formatHours } from "@/lib/format";

const STEP = 0.25;

/**
 * Hours in the entries table, editable in place: click to turn it into an input,
 * Enter saves, Escape (or clicking away) discards. Accepts "1,5" as well as "1.5";
 * −/+ (or ↓/↑) step by a quarter hour.
 */
export function EntryHoursCell({ entryId, hours }: { entryId: number; hours: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(hours); // the new value while saving; reverts if it fails
  const [pending, start] = useTransition();

  function begin() {
    setDraft(String(hours));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  /** Move to the next quarter hour up/down (1.1 → 1.25 / 1.0), kept within 0.25–24. */
  function step(dir: 1 | -1) {
    const typed = Number(draft.trim().replace(",", "."));
    const base = draft.trim() && Number.isFinite(typed) ? typed : hours;
    const next = dir > 0 ? Math.floor(base / STEP + 1e-9) * STEP + STEP : Math.ceil(base / STEP - 1e-9) * STEP - STEP;
    setDraft(String(Math.min(24, Math.max(STEP, Math.round(next * 100) / 100))));
    setError(null);
  }

  // Keep focus in the input while clicking −/+ (blurring would discard the edit).
  const stepButton = (dir: 1 | -1) => (
    <button
      type="button"
      className="btn btn-sm px-2 py-0.5"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => step(dir)}
      aria-label={dir > 0 ? "Add a quarter hour" : "Remove a quarter hour"}
      title={dir > 0 ? "+0.25 h" : "−0.25 h"}
    >
      {dir > 0 ? "+" : "−"}
    </button>
  );

  function save() {
    const value = Number(draft.trim().replace(",", "."));
    if (!draft.trim() || !Number.isFinite(value)) {
      setError("Enter hours as a number, e.g. 1.5");
      return;
    }
    setEditing(false);
    if (value === hours) return;
    start(async () => {
      setShown(value);
      const r = await updateEntryHoursAction(entryId, value);
      if (!r?.ok) {
        setDraft(String(value));
        setError(r?.error ?? "Could not save.");
        setEditing(true);
      }
    });
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col items-end">
        <span className="inline-flex items-center gap-1">
          {stepButton(-1)}
          <input
            className={`input num w-16 py-0.5 text-right text-sm ${error ? "border-red-400 dark:border-red-700" : ""}`}
            inputMode="decimal"
            value={draft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                step(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
            onBlur={cancel}
            aria-label="Hours"
            aria-invalid={!!error}
          />
          {stepButton(1)}
        </span>
        {error && <span className="mt-0.5 text-xs font-normal text-red-600 dark:text-red-400">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      className={`-mx-1 cursor-text rounded px-1 tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-800 ${pending ? "opacity-60" : ""}`}
      title="Click to edit · Enter saves · Esc cancels"
    >
      {formatHours(shown)}
    </button>
  );
}
