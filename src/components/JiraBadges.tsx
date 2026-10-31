"use client";

import { setJiraCommentResolvedAction } from "@/plugins/jira/server-actions";
import type { JiraCommentView } from "@/lib/todos/shared";
import type { JiraTicketBrief } from "@/lib/entities-shared";
import { SourceCard } from "./SourceCard";
import { ResolvedMark } from "./ResolvedMark";
import { ResolveToggle } from "./ResolveToggle";
import { formatDateTime, formatDayTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const full = (iso: string) => formatDayTime(iso, { year: true });

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

/** A Jira comment as a small card: who wrote it on which ticket, when, how it starts; ↗ opens it in Jira. With `onToggle` it unfolds. */
export function JiraCommentBadge({ c, className = "", expanded = false, onToggle }: { c: JiraCommentView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <SourceCard
      tone="sky"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
          <path d="M4 4.5h12v8.5H9.5L6 16v-3H4z" />
        </svg>
      }
      kind={t("Jira comment")}
      mark={<ResolvedMark done={c.resolved} />}
      when={c.at ? formatDateTime(c.at) : undefined}
      title={c.ticket}
      sub={c.author || undefined}
      snippet={c.text ? c.text.replace(/\s+/g, " ").trim() : undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the whole comment")}
      href={c.url || undefined}
      hrefTitle={t("Open the comment on {ticket} in Jira", { ticket: c.ticket })}
      className={className}
    />
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

/** A Jira ticket as a small card: its summary, key, status and assignee; ↗ opens it in Jira. With `onToggle` it unfolds. */
export function JiraTicketBadge({ t: tk, className = "", expanded = false, onToggle }: { t: JiraTicketBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <SourceCard
      tone="sky"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
          <path d="M5 3.5h10v13H5z M7.5 7h5 M7.5 10h5 M7.5 13h3" />
        </svg>
      }
      kind={t("Jira ticket")}
      state={tk.status ? { text: tk.status, className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" } : undefined}
      title={tk.summary || tk.key}
      sub={[tk.key, tk.assignee].filter(Boolean).join(" · ")}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the whole ticket")}
      href={tk.url}
      hrefTitle={t("Open {key} in Jira", { key: tk.key })}
      className={className}
    />
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
