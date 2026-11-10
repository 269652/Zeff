"use client";

import { usePagePathname } from "@/lib/use-page-pathname";
import type { ReactNode } from "react";

/** Pages that fill the window's height exactly (a Kanban board's columns side by side, the chat, the todos); the others scroll here. */
const WIDE = [/^\/kanban\/(?!settings)[^/]+/, /^\/knowledge/, /^\/todos/, /^\/tickets/, /^\/work/, /^\/chat/, /^\/learn\/[^/]+\/step\//];
/**
 * Of those, the ones that flow on a phone (their content grows past the window there and the page scrolls): the room
 * for the bottom bar must come after their content — fitted to the window, it ended mid-list, the last todo under the bar.
 */
const FLOW_ON_PHONE = [/^\/todos/];

export function MainArea({ children }: { children: ReactNode }) {
  const path = usePagePathname();
  const wide = WIDE.some((r) => r.test(path));
  const flow = wide && FLOW_ON_PHONE.some((r) => r.test(path));
  // The one place that scrolls (a long page); a full-window page (a board, the chat) fits it exactly.
  // A size container: a sidebar that should fill the window's height measures it in cqh (no guessed header height).
  return (
    <main id="main" tabIndex={0} className="min-h-0 w-full flex-1 overflow-y-auto [container-type:size]">
      {/* At most 1440 px wide, centred — on a wide screen the pages and app views keep their shape (the header the same). */}
      <div className={`mx-auto w-full max-w-[1440px] px-4 pt-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-3 ${flow ? "min-h-full sm:h-full" : wide ? "h-full" : ""}`}>{children}</div>
    </main>
  );
}
