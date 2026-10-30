"use client";

import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";
import { I18nProvider } from "@/components/I18nProvider";
import type { Lang } from "@/lib/i18n/shared";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

/** What a suggestion menu component gets. */
export type MenuProps<T> = { items: T[]; selected: number; query: string; onPick: (index: number) => void; onHover: (index: number) => void };

/**
 * The popup of a Tiptap suggestion (the slash menu, the @ menu): a small React root in a fixed box next to
 * the caret, kept in the window; arrow keys, Enter and Escape handled here.
 */
export function suggestionRender<T>(Menu: ComponentType<MenuProps<T>>, getLang: () => Lang, opts: { hideEmpty?: boolean } = {}) {
  return () => {
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;
    let props: SuggestionProps<T, T> | null = null;
    let index = 0;

    const place = () => {
      const rect = props?.clientRect?.();
      if (!host || !rect) return;
      const h = host.offsetHeight;
      const below = window.innerHeight - rect.bottom;
      host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - host.offsetWidth - 8))}px`;
      host.style.top = below < h + 12 && rect.top > h + 12 ? `${rect.top - h - 6}px` : `${rect.bottom + 6}px`;
    };
    const draw = () => {
      if (!root || !props) return;
      root.render(
        <I18nProvider lang={getLang()}>
          <Menu items={props.items} selected={index} query={props.query} onPick={(i) => props?.items[i] !== undefined && props.command(props.items[i])} onHover={(i) => ((index = i), draw())} />
        </I18nProvider>,
      );
      // Nothing to offer (a slash menu for plain text after a slash): no box at all.
      if (host) host.style.display = opts.hideEmpty && !props.items.length ? "none" : "";
      // After React has put the menu in: where it goes depends on its size.
      requestAnimationFrame(place);
    };
    const close = () => {
      root?.unmount();
      host?.remove();
      host = null;
      root = null;
      props = null;
    };

    return {
      onStart(p: SuggestionProps<T, T>) {
        props = p;
        index = 0;
        host = document.createElement("div");
        host.className = "ws-pop";
        host.setAttribute("role", "listbox");
        host.addEventListener("mousedown", (e) => e.preventDefault());
        document.body.appendChild(host);
        root = createRoot(host);
        draw();
      },
      onUpdate(p: SuggestionProps<T, T>) {
        // Another query (a picker opened: "/ticket "): from the top again.
        index = p.query !== props?.query ? 0 : Math.min(index, Math.max(0, p.items.length - 1));
        props = p;
        draw();
      },
      onKeyDown({ event }: SuggestionKeyDownProps) {
        if (!props) return false;
        const n = props.items.length;
        if (event.key === "Escape") {
          close();
          return true;
        }
        if (!n) return false;
        if (event.key === "ArrowDown") {
          index = (index + 1) % n;
          draw();
          return true;
        }
        if (event.key === "ArrowUp") {
          index = (index - 1 + n) % n;
          draw();
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          props.command(props.items[index]);
          return true;
        }
        return false;
      },
      onExit: close,
    };
  };
}
