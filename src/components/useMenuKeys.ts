"use client";

import { useEffect, type RefObject } from "react";

/** What a menu's arrow keys stop at: its entries that take the focus. */
const ITEMS = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"], [role^="menuitem"]:not([aria-disabled="true"])';

/**
 * A popup menu by keyboard (WCAG 2.1.1, the ARIA menu pattern): when it opens the focus goes to its first entry (a menu
 * drawn in a portal at the end of the page is out of the Tab order otherwise), ↑ ↓ Home End move between the entries,
 * Escape closes it and gives the focus back to its button, Tab closes it and goes on from the button.
 * `close` is called for Escape and Tab — the menu's own handlers for a click outside stay as they are.
 */
export function useMenuKeys(open: boolean, menu: RefObject<HTMLElement | null>, button: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    // The menu may be drawn a frame later (placed first): the focus goes in once it is there.
    let tries = 0;
    let frame = 0;
    const focusFirst = () => {
      const first = items().find((el) => el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-current")) ?? items()[0];
      if (first) first.focus();
      else if (tries++ < 10) frame = requestAnimationFrame(focusFirst);
    };
    // (Only when the keyboard opened it or the focus is on its button — a menu opened by hovering doesn't take the focus.)
    if (!button.current || button.current.contains(document.activeElement)) frame = requestAnimationFrame(focusFirst);
    const key = (e: KeyboardEvent) => {
      const m = menu.current;
      if (!m) return;
      const inside = m.contains(document.activeElement);
      if (e.key === "Escape") {
        if (!inside && !button.current?.contains(document.activeElement)) return;
        e.preventDefault();
        close();
        // Now, and once more after the menu is gone (a page's own Escape handler may blur meanwhile).
        const b = button.current;
        b?.focus();
        setTimeout(() => b?.isConnected && document.activeElement !== b && b.focus(), 0);
        return;
      }
      if (!inside) {
        // ↓ on the button opens into the menu.
        if (e.key === "ArrowDown" && button.current?.contains(document.activeElement)) {
          e.preventDefault();
          items()[0]?.focus();
        }
        return;
      }
      if (e.key === "Tab") {
        close();
        button.current?.focus();
        return;
      }
      // In a text field the arrow keys and Home/End are the field's own.
      if (document.activeElement instanceof HTMLInputElement && document.activeElement.type !== "checkbox" && document.activeElement.type !== "radio") return;
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const to = e.key === "ArrowDown" ? (i + 1) % list.length : e.key === "ArrowUp" ? (i - 1 + list.length) % list.length : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : -1;
      if (to < 0 || !list.length) return;
      e.preventDefault();
      list[to].focus();
    };
    // In the capture phase: before the menus' own Escape handlers close it (and the menu with its focus is gone).
    document.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, menu, button, close]);
}
