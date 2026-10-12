"use client";

import { Markdown } from "../Markdown";

/**
 * A plugin document as Markdown. A client component because Markdown translates its own texts with
 * useT() — a hook a server component can't call (the docs page is one).
 */
export function DocsMarkdown({ text }: { text: string }) {
  return <Markdown text={text} />;
}
