"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/**
 * Focus management for something dialog-like: on mount remember the focused element and move focus
 * into `ref` (its first focusable, else the element itself), keep Tab/Shift+Tab inside it, call
 * `onEscape` on Escape, and put focus back where it was on unmount.
 */
export function useOverlayFocus(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const esc = useRef(onEscape);
  useEffect(() => {
    esc.current = onEscape;
  });
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) {
      if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
      (focusables(root)[0] ?? root).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (esc.current) {
          e.preventDefault();
          esc.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement;
      if (!root.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (at === first || at === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [ref, active]);
}

/**
 * A modal dialog: backdrop + panel in a portal, role="dialog" aria-modal, focus moved in, trapped,
 * restored on close; Escape and a click on the backdrop close it. While `dirty`, those two ask first
 * (`onDirtyClose`, or a confirm) instead of throwing the edits away.
 */
export function Overlay({ open, onClose, label, side = "right", dirty, onDirtyClose, className = "", children }: { open: boolean; onClose: () => void; label: string; side?: "right" | "center"; dirty?: boolean; onDirtyClose?: () => void; className?: string; children: ReactNode }) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const tryClose = () => {
    if (!dirty) return onClose();
    if (onDirtyClose) return onDirtyClose();
    if (confirmAction(t("Discard your unsaved changes?"))) onClose();
  };
  useOverlayFocus(panel, open, tryClose);
  if (!open || typeof document === "undefined") return null;
  const place = side === "right" ? "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950" : "relative z-50 flex max-h-[90vh] w-full flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950";
  return createPortal(
    <div className={side === "center" ? "fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/30 p-4" : undefined}>
      {side === "right" ? <div className="fixed inset-0 z-40 bg-zinc-950/30" onClick={tryClose} aria-hidden /> : <div className="absolute inset-0" onClick={tryClose} aria-hidden />}
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={`${place} ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
