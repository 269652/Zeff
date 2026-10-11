"use client";

import { useT } from "@/components/I18nProvider";
import { ChevronIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { KIND_ICONS, sizeText, type DocView } from "./shared";
import type { DocOrigin } from "@/lib/mail/shared";

const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-teal-200 bg-teal-50 text-xs text-teal-950 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";

/** A document as a badge: "📕 Mietvertrag.pdf" — with `onToggle` it unfolds. */
export function DocBadge({ d, className = "", expanded = false, onToggle }: { d: DocView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const body = (
    <>
      {onToggle && <ChevronIcon open={expanded} className="size-3.5 shrink-0 text-teal-500" />}
      <span aria-hidden>{KIND_ICONS[d.kind]}</span>
      <span className="min-w-0 truncate font-medium">{d.name}</span>
      {d.status !== "ready" && <span className="shrink-0 text-teal-700/70 dark:text-teal-300/70">{statusText(d, t)}</span>}
    </>
  );
  return (
    <div className={`${BADGE} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${INNER} cursor-pointer transition hover:bg-teal-100 dark:hover:bg-teal-950`} onClick={onToggle} aria-expanded={expanded} title={expanded ? t("Fold") : t("Show the document")}>
          {body}
        </button>
      ) : (
        <span className={INNER}>{body}</span>
      )}
    </div>
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
