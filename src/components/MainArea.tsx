"use client";

import { usePagePathname } from "@/lib/use-page-pathname";
import type { ReactNode } from "react";

/** Pages that fill the window's height exactly (a Kanban board's columns side by side, the chat, the todos); the others scroll here. */
const WIDE = [/^\/kanban\/(?!settings)[^/]+/, /^\/knowledge/, /^\/todos/, /^\/tickets/, /^\/work/];

export function MainArea({ children }: { children: ReactNode }) {
  const path = usePagePathname();
  const wide = WIDE.some((r) => r.test(path));
  // The one place that scrolls (a long page); a full-window page (a board, the chat) fits it exactly.
  return (
    <main id="main" tabIndex={0} className="min-h-0 w-full flex-1 overflow-y-auto">
      {/* At most 1440 px wide, centred — on a wide screen the pages and app views keep their shape (the header the same). */}
      <div className={`mx-auto w-full max-w-[1440px] px-4 pt-3 pb-20 sm:pb-3 ${wide ? "h-full" : ""}`}>{children}</div>
    </main>
  );
}
