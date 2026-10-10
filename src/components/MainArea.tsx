"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Pages that fill the window's height exactly (a Kanban board's columns side by side, the chat, the todos); the others scroll here. */
const WIDE = [/^\/kanban\/(?!settings)[^/]+/, /^\/knowledge/, /^\/todos/, /^\/tickets/, /^\/work/];

export function MainArea({ children }: { children: ReactNode }) {
  const path = usePathname();
  const wide = WIDE.some((r) => r.test(path));
  // The one place that scrolls (a long page); a full-window page (a board, the chat) fits it exactly.
  return (
    <main className="min-h-0 w-full flex-1 overflow-y-auto">
      <div className={`px-4 py-3 ${wide ? "h-full" : ""}`}>{children}</div>
    </main>
  );
}
