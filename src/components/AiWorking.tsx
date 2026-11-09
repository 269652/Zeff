"use client";

import { useEffect, useState } from "react";

/**
 * "The AI is at work" (a building block of Zeff): a bar of moving colour across the top of what it works on (like
 * Google's progress), and a line with a glyph that turns and a shimmer running through the words (like Claude Code's).
 * Reduced motion (the system's setting): the bar stands, the glyph stays, no shimmer (globals.css).
 */
export function AiProgressBar({ className = "" }: { className?: string }) {
  return <div className={`ai-progress ${className}`} role="progressbar" aria-busy="true" aria-valuetext="…" />;
}

/** The turning glyph and the words, shimmering; `detail` after them (the step it's on), not shimmering. */
export function AiWorkingLabel({ label, detail, className = "" }: { label: string; detail?: string; className?: string }) {
  return (
    <p className={`flex min-w-0 items-center gap-2 text-sm ${className}`} role="status" aria-live="polite">
      <span className="ai-glyph" aria-hidden />
      <span className="ai-shimmer shrink-0 font-medium">{label}</span>
      {detail && <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">{detail}</span>}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Which pages the Workspace assistant is working on right now (its panel tells; a database shows the bar meanwhile).
// ---------------------------------------------------------------------------------------------------------------------

const EVENT = "zeff:ai-working";
type Detail = { pageId: number | null; on: boolean };

/** The assistant started or stopped working with `pageId` open. */
export function announceAiWorking(pageId: number | null | undefined, on: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { pageId: pageId ?? null, on } }));
}

/** Whether the assistant is working on this page now. */
export function useAiWorkingOn(pageId: number | null | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const listen = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (d && pageId && d.pageId === pageId) setOn(d.on);
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [pageId]);
  return on;
}
