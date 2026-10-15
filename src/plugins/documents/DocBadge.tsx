"use client";

import { useT } from "@/components/I18nProvider";
import { SourceCard } from "@/components/SourceCard";
import { formatDate } from "@/lib/format";
import { KIND_ICONS, sizeText, type DocView } from "./shared";
import type { DocOrigin } from "@/lib/mail/shared";


/** A document as a small card: its name, what kind and how big — a picture shows itself. With `onToggle` it unfolds. */
export function DocBadge({ d, className = "", expanded = false, onToggle }: { d: DocView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const state = statusText(d, t);
  return (
    <SourceCard
      tone="teal"
      icon={<span className="text-base leading-none">{KIND_ICONS[d.kind]}</span>}
      kind={t("Document")}
      state={state ? { text: state, className: d.status === "failed" ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : undefined } : undefined}
      title={d.name}
      sub={sizeText(d.size)}
      snippet={d.status === "ready" ? d.abstract || undefined : undefined}
      thumb={d.kind === "image" ? `/api/documents/${d.id}/file` : undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the document")}
      className={className}
    />
  );
}

function statusText(d: DocView, t: ReturnType<typeof useT>): string {
  return d.status === "ready" ? "" : d.status === "queued" || d.status === "extracting" ? t("being read …") : d.status === "unsupported" ? t("not readable") : t("failed");
}

/** "from mail <subject>" — a document that came from a mail's attachment (Mail attachments → Documents). */
export function OriginLine({ o }: { o: DocOrigin }) {
  const t = useT();
  const when = formatDate(o.receivedAt, { weekday: false });
  return (
    <span className="block min-w-0 truncate text-xs text-zinc-500" title={[o.subject, o.from, when].filter(Boolean).join(" · ")}>
      {t("from mail")} <span className="text-zinc-700 dark:text-zinc-300">{o.subject}</span>
      {o.from ? " · " + o.from : ""} · {when}
    </span>
  );
}

/** A document's card: what it is, its abstract (the knowledge server's, once it compiled it), concepts, and a link to the file. */
export function DocDetails({ d, origin }: { d: DocView; origin?: DocOrigin }) {
  const t = useT();
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate font-medium">
          <span aria-hidden>{KIND_ICONS[d.kind]}</span> {d.name}
        </p>
        <span className="shrink-0 text-xs text-zinc-400">
          {sizeText(d.size)} · {formatDate(d.createdAt, { weekday: false, year: true })}
        </span>
      </div>
      {origin && <OriginLine o={origin} />}
      {d.status === "ready" ? (
        <>
          <p className="text-xs font-semibold text-zinc-500 uppercase">{d.compiled ? t("Abstract") : t("Beginning (not compiled yet)")}</p>
          <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{d.abstract || t("(no text)")}</p>
          {d.concepts.length > 0 && <p className="text-xs text-zinc-500">{d.concepts.join(" · ")}</p>}
        </>
      ) : (
        <p className={`text-xs ${d.status === "failed" ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{d.error || statusText(d, t)}</p>
      )}
      <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
        {t("Open the file ↗")}
      </a>
    </div>
  );
}
