"use client";

import { useT } from "@/components/I18nProvider";
import { keepNoteClass } from "./colors";
import { noteHeadline, type KeepNoteBrief } from "./shared";

/** A note as a source's badge: "Note · its title" — with `onToggle`, it unfolds. */
export function KeepNoteBadge({ n, className = "", expanded, onToggle }: { n: KeepNoteBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const body = (
    <>
      <span className="shrink-0 rounded bg-yellow-100 px-1 text-[10px] font-semibold text-yellow-800 uppercase dark:bg-yellow-950 dark:text-yellow-300">{t("Note")}</span>
      <span className="truncate">{noteHeadline(n, t("Note"))}</span>
      <span className="shrink-0 text-zinc-400">{n.where}</span>
    </>
  );
  const cls = `inline-flex max-w-full items-center gap-1.5 rounded border border-zinc-200 px-1.5 py-0.5 text-xs dark:border-zinc-700 ${n.archived ? "opacity-60" : ""} ${className}`;
  return onToggle ? (
    <button type="button" className={`${cls} text-left hover:bg-zinc-50 dark:hover:bg-zinc-800`} onClick={onToggle} aria-expanded={!!expanded}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/** A note in full, as a card: title, text, labels, where it lives (a link). */
export function KeepNoteDetails({ n }: { n: KeepNoteBrief }) {
  return (
    <div className={`card space-y-1.5 p-3 text-sm ${keepNoteClass(n.color)}`}>
      {n.title && <p className="font-medium">{n.title}</p>}
      {n.text && <p className="line-clamp-[16] whitespace-pre-line break-words">{n.text}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        {n.labels.map((l) => (
          <span key={l} className="rounded-full bg-zinc-200/70 px-2 py-0.5 dark:bg-zinc-700/70">
            {l}
          </span>
        ))}
        <a href={n.url} target={n.url.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="ml-auto text-indigo-600 hover:underline dark:text-indigo-400">
          {n.where} ↗
        </a>
      </div>
    </div>
  );
}
