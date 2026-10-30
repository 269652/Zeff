"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";
import { useOverlayFocus } from "@/components/Overlay";
import { useDismiss } from "@/components/useDismiss";

/** A dialog over the page: a backdrop, Escape and a click outside close it. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, true, onClose);
  // The focus goes in, Tab stays in it, and goes back to where it was when it closes (Escape: useDismiss).
  useOverlayFocus(box, true);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} space-y-3 p-4 shadow-xl outline-none`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
