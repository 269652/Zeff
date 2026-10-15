"use client";

import { Fragment, type ReactNode } from "react";
import { NOTE_IMAGE } from "@/plugins/documents/shared";

/**
 * A note's text with its pictures inline: ![title](doc:12) is the stored picture, small, a click opens it whole.
 * Everything between is rendered by `render` (the tagged people, the todo references). `compact`: a line of text —
 * a picture is its title with a small picture mark.
 */
export function NoteText({ text, render, compact }: { text: string; render: (s: string) => ReactNode; compact?: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(NOTE_IMAGE)) {
    if (m.index > last) parts.push(<Fragment key={`t${i++}`}>{render(text.slice(last, m.index))}</Fragment>);
    const title = m[1] || "Bild";
    if (compact) parts.push(<Fragment key={`i${i++}`}>{`🖼 ${title}`}</Fragment>);
    else
      parts.push(
        <a key={`i${i++}`} href={`/api/documents/${m[2]}/file`} target="_blank" rel="noreferrer" className="my-1 block w-fit" title={title}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored file of the Documents plugin */}
          <img src={`/api/documents/${m[2]}/file`} alt={title} className="max-h-56 max-w-full rounded-md border border-zinc-200 dark:border-zinc-700" loading="lazy" />
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (!parts.length) return <>{render(text)}</>;
  if (last < text.length) parts.push(<Fragment key={`t${i++}`}>{render(text.slice(last))}</Fragment>);
  return <>{parts}</>;
}
