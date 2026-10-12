import { isChatFolder, mailSender, outlookLink, type MailView } from "@/lib/mail/shared";
import { ChevronIcon } from "./icons";
import { ResolvedMark } from "./ResolvedMark";
import { formatDateTime } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";
import { useT } from "@/components/I18nProvider";

const when = (iso: string) => formatDateTime(iso);

/** "Mail", or the chat app ("WhatsApp", "Signal") for a chat's message (the mail sync reads those too). */
const kindOf = (m: Pick<MailView, "folder">, t: T) => (isChatFolder(m.folder) ? m.folder : t("Mail"));

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";
const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-sky-200 bg-sky-50 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100";
/** A chat's message: WhatsApp's green, not the mail's blue. */
const CHAT_BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100";

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 5.5 7 5.25 7-5.25" />
    </svg>
  );
}

/** A chat bubble — a WhatsApp message (not a mail). */
export function ChatIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 3.25c3.9 0 7 2.7 7 6.1s-3.1 6.1-7 6.1c-.9 0-1.8-.15-2.6-.42L3.5 16.5l1.1-3.3C3.6 12.1 3 10.8 3 9.35c0-3.4 3.1-6.1 7-6.1Z" />
    </svg>
  );
}

/** A mail as a badge: who wrote it, when, its subject — like a comment's. With `onToggle` it unfolds. */
export function MailBadge({ m, className = "", expanded = false, onToggle }: { m: MailView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const chat = isChatFolder(m.folder);
  const body = (
    <>
      {onToggle && <ChevronIcon open={expanded} className={`size-3.5 shrink-0 ${chat ? "text-emerald-500 dark:text-emerald-400" : "text-sky-500 dark:text-sky-400"}`} />}
      {chat ? <ChatIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <MailIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />}
      <ResolvedMark done={!!m.resolvedAt} />
      <span className="shrink-0 font-medium">{mailSender(m)}</span>
      <span className={`shrink-0 ${chat ? "text-emerald-700/80 dark:text-emerald-300/80" : "text-sky-700/80 dark:text-sky-300/80"}`}>{kindOf(m, t)} · {when(m.receivedAt)}</span>
      <span className={`min-w-0 truncate ${chat ? "text-emerald-900/70 dark:text-emerald-100/70" : "text-sky-900/70 dark:text-sky-100/70"}`}>{m.subject}</span>
    </>
  );
  return (
    <div className={`${chat ? CHAT_BADGE : BADGE} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${INNER} cursor-pointer transition ${chat ? "hover:bg-emerald-100 dark:hover:bg-emerald-950" : "hover:bg-sky-100 dark:hover:bg-sky-950"}`} onClick={onToggle} aria-expanded={expanded} title={expanded ? t("Fold") : chat ? t("Show the message") : t("Show the mail")}>
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
  const t = useT();
  const link = outlookLink(m);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>{kindOf(m, t)} · {when(m.receivedAt)}{m.unread ? ` · ${t("unread")}` : ""}</span>
        <span title={m.fromEmail ?? undefined}>{mailSender(m)}</span>
      </div>
      <p className="font-medium text-zinc-800 dark:text-zinc-100">{m.subject}</p>
      <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{m.preview || t("(no text in the preview)")}</p>
      <p className="text-xs text-zinc-400">{m.folder === "WhatsApp"
          ? t("The chat's last message, as WhatsApp's chat list shows it — the history is in WhatsApp.")
          : m.folder === "Signal"
          ? t("A message from your Signal chat — the whole chat is in Signal.")
          : t("The first lines, as the list shows them — the whole mail is in the mailbox.")}</p>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
          {t("Open in Outlook")} ↗
        </a>
      )}
    </div>
  );
}
