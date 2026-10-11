"use client";

import { setJiraCommentResolvedAction } from "@/plugins/jira/server-actions";
import type { JiraCommentView } from "@/lib/boards/shared";
import type { JiraTicketBrief } from "@/lib/entities-shared";
import { ChevronIcon } from "./icons";
import { ResolvedMark } from "./ResolvedMark";
import { ResolveToggle } from "./ResolveToggle";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const when = (iso: string) => formatDateTime(iso);
const full = (iso: string) => `${formatDate(iso, { year: true })}, ${formatTime(iso)}`;

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-jira-200 bg-jira-50 text-xs text-jira-950 dark:border-jira-900 dark:bg-jira-950/40 dark:text-jira-100";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";
const OPEN = "flex shrink-0 items-center px-2 text-jira-700 transition hover:bg-jira-100 dark:text-jira-300 dark:hover:bg-jira-950";

/** A Jira badge's body: a button that unfolds it (with `onToggle`), else just its content. */
function Body({ expanded, onToggle, what, children }: { expanded: boolean; onToggle?: () => void; what: "comment" | "ticket"; children: React.ReactNode }) {
  const t = useT();
  return onToggle ? (
    <button type="button" className={`${INNER} cursor-pointer transition hover:bg-jira-100 dark:hover:bg-jira-950`} onClick={onToggle} aria-expanded={expanded} title={expanded ? t("Fold") : what === "comment" ? t("Show the whole comment") : t("Show the whole ticket")}>
      <ChevronIcon open={expanded} className="size-3.5 shrink-0 text-jira-500 dark:text-jira-400" />
      {children}
    </button>
  ) : (
    <span className={INNER}>{children}</span>
  );
}

/** A Jira comment as a badge: who wrote it on which ticket, when, how it starts; ↗ opens it in Jira. With `onToggle` it unfolds. */
export function JiraCommentBadge({ c, className = "", expanded = false, onToggle }: { c: JiraCommentView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <div className={`${BADGE} ${className}`}>
      <Body expanded={expanded} onToggle={onToggle} what="comment">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className="size-4 shrink-0 text-jira-500 dark:text-jira-400" aria-hidden>
          <path d="M4 4.5h12v8.5H9.5L6 16v-3H4z" />
        </svg>
        <ResolvedMark done={c.resolved} />
        <span className="shrink-0 font-medium">{c.author || t("Jira comment")}</span>
        <span className="shrink-0 text-jira-700/80 max-sm:min-w-0 max-sm:shrink max-sm:truncate dark:text-jira-300/80">
          {c.ticket}
          {c.at ? ` · ${when(c.at)}` : ""}
        </span>
        {c.text && <span className="min-w-0 truncate text-jira-900/70 dark:text-jira-100/70">{c.text}</span>}
      </Body>
      {c.url && (
        <a href={c.url} target="_blank" rel="noreferrer" className={OPEN} title={t("Open the comment on {ticket} in Jira", { ticket: c.ticket })} aria-label={t("Open in Jira")}>
          ↗
        </a>
      )}
    </div>
  );
}

/** A Jira comment in full, as a card: what it says, who and when — mark it done here too. */
export function JiraCommentDetails({ c }: { c: JiraCommentView }) {
  const t = useT();
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>{t("Jira · comment on {ticket}", { ticket: c.ticket })}</span>
        <span className="flex items-center gap-2">
          <ResolveToggle done={c.resolved} onChange={(next) => setJiraCommentResolvedAction(c.id, c.ticket, next)} />
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              {t("Open in Jira")} ↗
            </a>
          )}
        </span>
      </div>
      {c.text ? (
        <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{c.text}</p>
      ) : (
        <p className="text-zinc-400">{t("Zeff hasn't read the text — open the comment in Jira.")}</p>
      )}
      {(c.author || c.at) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {c.author && (
            <>
              <dt className="text-zinc-500">{t("By")}</dt>
              <dd>{c.author}</dd>
            </>
          )}
          {c.at && (
            <>
              <dt className="text-zinc-500">{t("Written")}</dt>
              <dd>{full(c.at)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/** A Jira ticket as a badge: its key, status and summary; ↗ opens it in Jira. With `onToggle` it unfolds. */
export function JiraTicketBadge({ t: tk, className = "", expanded = false, onToggle }: { t: JiraTicketBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <div className={`${BADGE} ${className}`}>
      <Body expanded={expanded} onToggle={onToggle} what="ticket">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className="size-4 shrink-0 text-jira-500 dark:text-jira-400" aria-hidden>
          <path d="M5 3.5h10v13H5z M7.5 7h5 M7.5 10h5 M7.5 13h3" />
        </svg>
        <span className="shrink-0 font-mono font-medium">{tk.key}</span>
        {tk.status && <span className="shrink-0 rounded bg-jira-100 px-1 text-[11px] text-jira-800 dark:bg-jira-900/60 dark:text-jira-200">{tk.status}</span>}
        <span className="min-w-0 truncate text-jira-900/80 dark:text-jira-100/80">{tk.summary}</span>
      </Body>
      <a href={tk.url} target="_blank" rel="noreferrer" className={OPEN} title={t("Open {key} in Jira", { key: tk.key })} aria-label={t("Open in Jira")}>
        ↗
      </a>
    </div>
  );
}

/** A Jira ticket in full, as a card: summary, status, assignee, description. */
export function JiraTicketDetails({ t: tk }: { t: JiraTicketBrief }) {
  const t = useT();
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {t("Jira · Ticket")} <span className="font-mono">{tk.key}</span>
        </span>
        <a href={tk.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Open in Jira")} ↗
        </a>
      </div>
      <p className="font-medium text-zinc-800 dark:text-zinc-200">{tk.summary}</p>
      {tk.description && <p className="max-h-60 overflow-auto leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{tk.description}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-zinc-500">{t("Status")}</dt>
        <dd>{tk.status || "—"}</dd>
        <dt className="text-zinc-500">{t("Assignee")}</dt>
        <dd>{tk.assignee || t("nobody")}</dd>
      </dl>
    </div>
  );
}
