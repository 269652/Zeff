"use client";

import { useId } from "react";

/**
 * An iOS-style switch with its label next to it (the label says what the switch is set to: pass
 * `labelOn` / `labelOff`, or one `label`). Controlled by `checked`; `name` makes it a form field
 * (a checkbox's: "on" when set).
 */
export function Switch({
  checked,
  onChange,
  labelOn,
  labelOff,
  name,
  disabled,
  title,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelOn: string;
  labelOff?: string;
  name?: string;
  disabled?: boolean;
  title?: string;
  /** The accessible name when the visible text is a state word pair (labelOn/labelOff differ). */
  label?: string;
  className?: string;
}) {
  const textId = useId();
  const staticLabel = labelOff === undefined || labelOff === labelOn;
  const stateName = label ?? title ?? name ?? labelOn;
  return (
    <label className={`inline-flex items-center gap-2 text-xs select-none ${disabled ? "opacity-60" : "cursor-pointer"} ${className}`} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={staticLabel ? undefined : stateName}
        aria-labelledby={staticLabel ? textId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600"}`}
      >
        <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
      {name && <input type="checkbox" name={name} checked={checked} readOnly hidden />}
      <span id={textId} className={checked ? "font-medium text-indigo-700 dark:text-indigo-300" : "text-zinc-500"}>{checked ? labelOn : (labelOff ?? labelOn)}</span>
    </label>
  );
}
