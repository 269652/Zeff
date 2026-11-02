"use client";

/**
 * A script that runs as the page's HTML is read (before React hydrates) — and not again: on the client it is plain text, so
 * React doesn't warn about a <script> it renders (Next's guide "Preventing flash before hydration").
 */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
