"use client";

import type { ReactNode } from "react";
import { useT } from "./I18nProvider";
import { CloseIcon } from "./icons";
import { Overlay } from "./Overlay";

/**
 * A card's whole content in a lightbox: the page dims, the content sits in the middle (it scrolls when it
 * is long), Escape, the × or a click outside close it. Opened from the card's title.
 */
export function ContentLightbox({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const t = useT();
  return (
    <Overlay open={open} onClose={onClose} label={label} side="center" className="max-w-3xl">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close")} title={t("Close")}>
          <CloseIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </Overlay>
  );
}
