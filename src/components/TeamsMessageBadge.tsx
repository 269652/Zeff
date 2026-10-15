"use client";

import { useEffect, useState } from "react";
import { findTeamsMessagesAction, setTeamsResolvedAction } from "@/plugins/teams/server-actions";
import { teamsKindLabel, teamsLinkKey, teamsMarkdown, type TeamsMessageView } from "@/lib/teams/shared";
import { SourceCard } from "./SourceCard";
import { Markdown } from "./Markdown";
import { ResolvedMark } from "./ResolvedMark";
import { ResolveToggle } from "./ResolveToggle";
import { useIsClient } from "./useIsClient";
import { formatDateTime, formatDayTime, formatFull } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const full = (iso: string) => formatDayTime(iso, { year: true });

/**
 * The synced Teams messages these links point at, by link — looked up once per link (links
 * that aren't Teams message links aren't asked about).
 */
export function useSyncedTeamsMessages(urls: string[]): Record<string, TeamsMessageView | null> {
  const [found, setFound] = useState<Record<string, TeamsMessageView | null>>({});
  const ask = [...new Set(urls.filter((u) => teamsLinkKey(u) && !(u in found)))].join("\n");
  useEffect(() => {
    if (!ask) return;
    let live = true;
    findTeamsMessagesAction(ask.split("\n")).then((r) => {
      if (live) setFound((f) => ({ ...f, ...r }));
    });
    return () => {
      live = false;
    };
  }, [ask]);
  return found;
}

/**
 * A link to a synced Teams message, shown as the message: whether it's done, who wrote it, where
 * and when, and how it starts. With `onToggle` a click unfolds it (the chevron); ↗ opens it in
 * Teams. `resolved`: done by another account than its own mark (its copy in Jira).
 */
export function TeamsMessageBadge({
  m,
  className = "",
  expanded = false,
  onToggle,
  resolved,
}: {
  m: TeamsMessageView;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
  resolved?: boolean;
}) {
  const t = useT();
  const who = m.senderName ?? t("message");
  const at = formatFull(m.sentAt);
  const start = [m.subject, m.text].filter(Boolean).join(" — ");
  return (
    <SourceCard
      tone="violet"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
          <path d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3h9.5a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 14.75 14H9l-3.5 3v-3h-.25A1.75 1.75 0 0 1 3.5 12.25z" />
        </svg>
      }
      kind={`Teams · ${teamsKindLabel(m, t)}`}
      mark={<ResolvedMark done={resolved ?? !!m.resolvedAt} />}
      when={formatDateTime(m.sentAt)}
      title={m.senderName ?? "Teams"}
      sub={m.place || undefined}
      snippet={start || undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the whole message")}
      href={m.link}
      hrefTitle={m.place ? t("Open in Teams: {who} in {place}, {at}", { who, place: m.place, at }) : t("Open in Teams: {who}, {at}", { who, at })}
      className={className}
    />
  );
}

/** A synced Teams message in full, as a card: what kind, all it says, who wrote it, where and when. */
export function TeamsMessageDetails({ m }: { m: TeamsMessageView }) {
  // The HTML → Markdown conversion needs the browser (DOMParser): plain text until then.
  const t = useT();
  const client = useIsClient();
  const { markdown, pictures } = client ? teamsMarkdown(m.html) : { markdown: m.text, pictures: 0 };
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          Teams · {teamsKindLabel(m, t)}
          {m.kind === "mention" && m.isRead === false ? ` · ${t("unread")}` : ""}
        </span>
        <span className="flex items-center gap-2">
          <ResolveToggle done={!!m.resolvedAt} onChange={(next) => setTeamsResolvedAction(m.key, next)} />
          <a href={m.link} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open in Teams")} ↗
          </a>
        </span>
      </div>
      {m.subject && <div className="font-medium leading-snug">{m.subject}</div>}
      {markdown.trim() ? <Markdown text={markdown} className="text-zinc-700 dark:text-zinc-300" /> : <p className="text-zinc-400">{t("(no text)")}</p>}
      {pictures > 0 && (
        <p className="text-xs text-zinc-400">
          {pictures === 1
            ? t("A picture — open the message in Teams to see it.")
            : t("{n} pictures — open the message in Teams to see them.", { n: pictures })}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-zinc-500">{t("From")}</dt>
        <dd>{m.senderName ?? "—"}</dd>
        {m.place && (
          <>
            <dt className="text-zinc-500">{t("In")}</dt>
            <dd>{m.place}</dd>
          </>
        )}
        <dt className="text-zinc-500">{t("Sent")}</dt>
        <dd>{full(m.sentAt)}</dd>
      </dl>
    </div>
  );
}
