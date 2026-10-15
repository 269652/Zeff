import { isChatFolder, mailSender, sourceLink, type MailView } from "@/lib/mail/shared";
import { SourceCard } from "./SourceCard";
import { ResolvedMark } from "./ResolvedMark";
import { formatDateTime } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";
import { useT } from "@/components/I18nProvider";


/** "Mail", or the chat app ("WhatsApp", "Signal") for a chat's message (the mail sync reads those too). */
const kindOf = (m: Pick<MailView, "folder">, t: T) => (isChatFolder(m.folder) ? m.folder : t("Mail"));

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

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

/** A mail as a small card: its subject, who wrote it, when, its first words — like a comment's. With `onToggle` it unfolds. */
export function MailBadge({ m, className = "", expanded = false, onToggle }: { m: MailView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const chat = isChatFolder(m.folder);
  return (
    <SourceCard
      tone={chat ? "emerald" : "sky"}
      icon={chat ? <ChatIcon /> : <MailIcon />}
      kind={kindOf(m, t)}
      mark={<ResolvedMark done={!!m.resolvedAt} />}
      state={m.unread ? { text: t("unread"), className: chat ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" } : undefined}
      when={formatDateTime(m.receivedAt)}
      title={m.subject || mailSender(m)}
      sub={m.subject ? mailSender(m) : undefined}
      snippet={m.preview || undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : chat ? t("Show the message") : t("Show the mail")}
      className={className}
    />
  );
}

/** A mail in full, as Zeff has it: subject, sender, when, its first lines (the list's — it isn't opened). */
export function MailDetails({ m }: { m: MailView }) {
  const t = useT();
  const link = sourceLink(m);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>{kindOf(m, t)} · {formatDateTime(m.receivedAt)}{m.unread ? ` · ${t("unread")}` : ""}</span>
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
        <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
          {link.label === "Open in Gmail" ? t("Open in Gmail") : t("Open in Outlook")} ↗
        </a>
      )}
    </div>
  );
}
