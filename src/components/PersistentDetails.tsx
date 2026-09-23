"use client";

import { useState, type ReactNode } from "react";
import { isOpen, rememberOpen, uiKey, type UiOpenState } from "@/lib/ui-state-shared";

/** A <details> panel that stays open (or closed) across reloads — its state is kept in a cookie. */
export function PersistentDetails({
  name,
  ui,
  defaultOpen = false,
  className,
  children,
}: {
  /** Stable panel name, e.g. "week-entries". */
  name: string;
  /** Remembered states from the server (getUiOpen). */
  ui: UiOpenState;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const key = uiKey.section(name);
  const [open, setOpen] = useState(() => isOpen(ui, key, defaultOpen));
  return (
    <details
      className={className}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return; // also fires when React applies `open` itself
        setOpen(next);
        rememberOpen(key, next, defaultOpen);
      }}
    >
      {children}
    </details>
  );
}
