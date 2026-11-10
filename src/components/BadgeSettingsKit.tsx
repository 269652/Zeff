"use client";

import { useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { BADGE_COLORS, BADGE_DOTS, BADGE_TONES, type BadgeColor } from "@/lib/badges/palette";
import type { ActionState } from "@/app/action-helpers";

/** The colours' names, as the swatches say them. */
export function useColorNames(): Record<BadgeColor, string> {
  const t = useT();
  return {
    indigo: t("Indigo"),
    sky: t("Sky blue"),
    teal: t("Teal"),
    emerald: t("Green"),
    amber: t("Amber"),
    red: t("Red"),
    rose: t("Rose"),
    violet: t("Violet"),
    zinc: t("Grey"),
  };
}

/**
 * A colour chosen from the badges' palette (Settings → Badges): a radio group of swatches — pills ("3") or dots — the chosen one ringed
 * and ticked. Arrow keys move the choice (one tab stop).
 */
export function BadgeColorPicker({ value, onChange, label, kind = "pill", disabled }: { value: BadgeColor; onChange: (c: BadgeColor) => void; label: string; kind?: "pill" | "dot"; disabled?: boolean }) {
  const names = useColorNames();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: React.KeyboardEvent, i: number) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const j = (i + by + BADGE_COLORS.length) % BADGE_COLORS.length;
    onChange(BADGE_COLORS[j]);
    refs.current[j]?.focus();
  };
  return (
    <div className={`flex flex-wrap gap-1 ${disabled ? "opacity-50" : ""}`} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {BADGE_COLORS.map((c, i) => {
        const on = value === c;
        return (
          <button
            key={c}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={names[c]}
            aria-label={names[c]}
            disabled={disabled}
            onClick={() => onChange(c)}
            onKeyDown={(e) => key(e, i)}
            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[11px] font-semibold leading-6 tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${kind === "pill" ? `px-1.5 ${BADGE_TONES[c]}` : "bg-zinc-100 dark:bg-zinc-800"} ${on ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100 dark:ring-offset-zinc-900" : ""}`}
          >
            {kind === "pill" ? (on ? "✓" : "3") : <span aria-hidden className={`size-2.5 rounded-full ${BADGE_DOTS[c]} ${on ? "outline-2 outline-offset-1 outline-zinc-900 dark:outline-zinc-100" : ""}`} />}
          </button>
        );
      })}
    </div>
  );
}

/** A section's settings, saved as they change (the newest save's answer is the one said). */
export function useAutoSave<C>(initial: C, action: (c: C) => Promise<ActionState>) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [said, setSaid] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const save = (next: C) => {
    setValue(next);
    const mine = ++seq.current;
    start(async () => {
      // (No connection: said here, not thrown at the page.)
      const r = await action(next).catch(() => ({ ok: false, error: t("Not saved — Zeff could not be reached. Try again.") }));
      if (mine === seq.current) setSaid(r?.ok ? t("Saved.") : (r?.error ?? null));
    });
  };
  return { value, save, status: pending ? t("Saving…") : said };
}

/** A section's foot: "Restore the default" (off while it is the default) and what the last save said. */
export function RestoreDefault({ isDefault, onRestore, status }: { isDefault: boolean; onRestore: () => void; status: string | null }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn" disabled={isDefault} onClick={onRestore}>
        {t("Restore the default")}
      </button>
      <span className="text-xs text-zinc-500" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
