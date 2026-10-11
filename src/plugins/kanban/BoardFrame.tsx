"use client";

import type { ReactNode } from "react";
import { SidebarFrame } from "@/components/SidebarFrame";
import { useT } from "@/components/I18nProvider";

/**
 * A board's frame: the sidebar on the left — back to all boards, the board's name and what it
 * is, its filters, its people — folded away on request; the columns on the right, the window's
 * whole height (each column scrolls in itself).
 */
export function BoardFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <SidebarFrame sidebar={sidebar} back={{ href: "/kanban", label: t("All boards") }} storageKey="zeff-kanban-sidebar" contentClassName="items-stretch gap-3 overflow-x-auto pb-2">
      {children}
    </SidebarFrame>
  );
}

/** A column's frame: its head, then its cards — scrolling in itself, the full height. */
export const COLUMN = "flex max-h-full min-h-0 min-w-72 flex-1 flex-col gap-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-900/60 max-lg:max-h-[70vh]";
