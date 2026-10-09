"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setPausesAction } from "@/app/actions";
import { formatHours } from "@/lib/format";
import { formatPauses, parsePauses, parseTime, totalPauseHours, type PauseRange } from "@/lib/pauses-shared";
import { useLockedBreakText } from "./useLockedBreakText";

const PRESET_MINUTES = [30, 45, 60];
const WIDTH = 300;

/** Below the cell, kept inside the window (fixed, so the table's scroll box can't clip it). */
function popoverPosition(el: HTMLElement | null): { top: number; left: number } {
  const r = el?.getBoundingClientRect();
  if (!r) return { top: 0, left: 0 };
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8)) };
}

const ranges = (ps: PauseRange[]) => ps.map((p) => `${p.start}–${p.end}`).join(", ");

/**
 * One day in the weekly table's Pause row: the break hours with each from–to below.
 * Without an entered break it shows the default break greyed out, with a + that takes it
 * for the day. Click to edit in a small popover — type "12-12:30", "12:15 45m", just "30"
 * (minutes from the usual start) or "none", or pick a preset. Enter saves, Esc closes.
 */
export function PauseCell({
  date,
  dayLabel,
  pauses,
  noBreak = false,
  shadow = [],
  suggestion,
  workdays,
}: {
  date: string;
  dayLabel: string;
  pauses: PauseRange[];
  /** The day is marked as having had no break (so no default applies). */
  noBreak?: boolean;
  /** The default break, shown greyed out while nothing is entered for the day. */
  shadow?: PauseRange[];
  /** The latest earlier break, offered when there is no default. */
  suggestion: PauseRange[];
  /** The week's working days, for "All workdays". */
  workdays: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [pending, startTransition] = useTransition();
  const cellRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const entered = pauses.length > 0 || noBreak;
  const showShadow = !entered && shadow.length > 0;
  // What an empty day's editor opens with: the default break, else the latest earlier one.
  const offer = shadow.length ? shadow : suggestion;
  // Lengths ("30", presets) start where this day's break does, else at the offered or usual time.
  const defaultStart = pauses[0]?.start ?? offer[0]?.start ?? "12:00";
  // Changing a start or end in the text moves that break; its length stays.
  const draftRef = useRef<HTMLInputElement>(null);
  const draftField = useLockedBreakText("", defaultStart, draftRef);
  const draft = draftField.text;
  const preview = parsePauses(draft, defaultStart);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !cellRef.current?.contains(t)) setOpen(false);
    };
    const onMove = () => setPos(popoverPosition(cellRef.current));
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function openEditor() {
    draftField.reset(noBreak ? "none" : formatPauses(pauses.length ? pauses : offer));
    setError(null);
    setPos(popoverPosition(cellRef.current));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    cellRef.current?.focus();
  }

  function save(text: string, dates: string[] = [date]) {
    const parsed = parsePauses(text, defaultStart);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      const r = await setPausesAction(dates, text, defaultStart);
      if (r?.ok) close();
      else setError(r?.error ?? "Could not save the break.");
    });
  }

  /** A preset length from the typed start (e.g. "12:15"), else from the usual start. */
  function preset(minutes: number) {
    const typed = parseTime(draft) ?? (preview.ok ? preview.pauses[0]?.start : undefined);
    save(`${typed ?? defaultStart} ${minutes}m`);
  }

  const previewText = error
    ? error
    : !preview.ok
      ? preview.error
      : preview.none
        ? "No break this day — the default doesn't apply"
        : preview.pauses.length
          ? `${ranges(preview.pauses)} · ${formatHours(totalPauseHours(preview.pauses))} h`
          : entered
            ? `Empty — Enter clears the day${shadow.length ? " (the default shows again)" : ""}`
            : "Nothing entered";

  return (
    <>
      <span className="inline-flex items-start justify-end gap-0.5">
        {showShadow && (
          <button
            type="button"
            onClick={() => save(formatPauses(shadow))}
            disabled={pending}
            className="rounded px-1 leading-5 font-semibold text-zinc-400 hover:bg-indigo-50 hover:text-indigo-600 dark:text-zinc-500 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
            title={`Take the default break (${ranges(shadow)}) for this day`}
            aria-label={`Take the default break for ${dayLabel}`}
          >
            +
          </button>
        )}
        <button
          ref={cellRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openEditor())}
          className={`-mx-1 rounded px-1 text-right hover:bg-zinc-100 dark:hover:bg-zinc-800 ${pending ? "opacity-60" : ""}`}
          title={
            pauses.length ? "Edit the break" : noBreak ? "No break this day — click to change" : showShadow ? "Default break, not entered — click to edit" : "Add a break"
          }
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {pauses.length ? (
            <>
              <span className="block tabular-nums">{formatHours(totalPauseHours(pauses))}</span>
              {pauses.map((p) => (
                <span key={p.start} className="block text-[11px] leading-tight whitespace-nowrap text-zinc-400 dark:text-zinc-500">
                  {p.start}–{p.end}
                </span>
              ))}
            </>
          ) : noBreak ? (
            <span className="text-[11px] whitespace-nowrap text-zinc-400 dark:text-zinc-500">no break</span>
          ) : showShadow ? (
            <span className="text-zinc-300 dark:text-zinc-600">
              <span className="block tabular-nums">{formatHours(totalPauseHours(shadow))}</span>
              {shadow.map((p) => (
                <span key={p.start} className="block text-[11px] leading-tight whitespace-nowrap">
                  {p.start}–{p.end}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">+</span>
          )}
        </button>
      </span>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Break on ${dayLabel}`}
          style={{ top: pos.top, left: pos.left, width: WIDTH }}
          className="card fixed z-50 space-y-2 p-3 text-left font-sans text-sm font-normal tracking-normal text-zinc-800 normal-case shadow-lg dark:text-zinc-100"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase">Break · {dayLabel}</span>
            {!entered && offer.length > 0 && (
              <span className="text-[11px] text-zinc-400">
                {shadow.length ? "default break — Enter takes it" : "last break — Enter repeats it"}
              </span>
            )}
          </div>
          <input
            ref={draftRef}
            className={`input py-1 font-mono ${error ? "border-red-400 dark:border-red-700" : ""}`}
            value={draft}
            autoFocus
            placeholder="12:00-12:30"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              draftField.onChange(e);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            aria-label="Break times"
            aria-invalid={!!error}
          />
          <p className={`text-xs ${error ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{previewText}</p>
          <div className="flex flex-wrap gap-1">
            {PRESET_MINUTES.map((m) => (
              <button key={m} type="button" className="btn btn-sm" disabled={pending} onClick={() => preset(m)}>
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending || !preview.ok || preview.pauses.length === 0 || workdays.length === 0}
              onClick={() => save(draft, workdays)}
              title="Set this break on every working day of the week"
            >
              All workdays
            </button>
            {!noBreak && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => save("none")}
                title="No break this day — nothing goes to Punch, not even the default"
              >
                No break
              </button>
            )}
            {entered && (
              <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => save("")}>
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] leading-snug text-zinc-400">
            Enter saves · Esc closes. Type 12-12:30, 12:15 45m, just 30 (minutes from {defaultStart}) or none;
            separate several breaks with “;”. Changing a start or end moves the break (its length stays) — use a
            preset or “12:00 45m” to change the length.
          </p>
        </div>
      )}
    </>
  );
}
