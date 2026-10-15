"use client";

import { useT } from "@/components/I18nProvider";
import { SourceCard } from "@/components/SourceCard";
import { formatDateTime } from "@/lib/format";
import { keepNoteClass } from "./colors";
import { noteHeadline, type KeepNoteBrief } from "./shared";

/** A Keep note as a small card: its title, where it lives, its first words — with `onToggle`, it unfolds. */
export function KeepNoteBadge({ n, className = "", expanded, onToggle }: { n: KeepNoteBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const title = noteHeadline(n, t("Note"));
  const lines = n.text.split("\n");
  const rest = (n.title ? n.text : lines.slice(1).join(" ")).replace(/\s+/g, " ").trim();
  return (
    <SourceCard
      tone="amber"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
          <path d="M4.5 3.5h11v9l-4 4h-7z M11.5 16.5v-4h4 M7 7.5h6 M7 10.5h3" />
        </svg>
      }
      kind={t("Keep note")}
      when={n.updatedAt ? formatDateTime(n.updatedAt) : undefined}
      title={title}
      sub={n.where}
      snippet={rest || undefined}
      expanded={!!expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the note")}
      className={`${n.archived ? "opacity-60" : ""} ${className}`}
    />
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
