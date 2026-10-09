import { mailSender, type MailView } from "@/lib/mail/shared";
import { ChevronIcon } from "./icons";
import { ResolvedMark } from "./ResolvedMark";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";
const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-sky-200 bg-sky-50 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100";

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 5.5 7 5.25 7-5.25" />
    </svg>
  );
}

/** A mail as a badge: who wrote it, when, its subject — like a comment's. With `onToggle` it unfolds. */
export function MailBadge({ m, className = "", expanded = false, onToggle }: { m: MailView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      {onToggle && <ChevronIcon open={expanded} className="size-3.5 shrink-0 text-sky-500 dark:text-sky-400" />}
      <MailIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <ResolvedMark done={!!m.resolvedAt} />
      <span className="shrink-0 font-medium">{mailSender(m)}</span>
      <span className="shrink-0 text-sky-700/80 dark:text-sky-300/80">Mail · {when(m.receivedAt)}</span>
      <span className="min-w-0 truncate text-sky-900/70 dark:text-sky-100/70">{m.subject}</span>
    </>
  );
  return (
    <div className={`${BADGE} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${INNER} cursor-pointer transition hover:bg-sky-100 dark:hover:bg-sky-950`} onClick={onToggle} aria-expanded={expanded} title={expanded ? "Fold" : "Show the mail"}>
          {body}
        </button>
      ) : (
        <span className={INNER}>{body}</span>
      )}
    </div>
  );
}

/** A mail in full, as Zeff has it: subject, sender, when, its first lines (the list's — it isn't opened). */
export function MailDetails({ m }: { m: MailView }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>Mail · {when(m.receivedAt)}{m.unread ? " · ungelesen" : ""}</span>
        <span title={m.fromEmail ?? undefined}>{mailSender(m)}</span>
      </div>
      <p className="font-medium text-zinc-800 dark:text-zinc-100">{m.subject}</p>
      <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{m.preview || "(kein Text in der Vorschau)"}</p>
      <p className="text-xs text-zinc-400">Die ersten Zeilen, wie Outlooks Liste sie zeigt — die ganze Mail in Outlook.</p>
    </div>
  );
}
