"use client";

import { useEffect, useState } from "react";
import { findGitlabItemsAction, setGitlabResolvedAction } from "@/plugins/gitlab/server-actions";
import { gitlabDone, gitlabKindLabels, gitlabLinkKey, gitlabMarkdown, resolvedInGitlab, type GitlabItemView, type GitlabKind } from "@/lib/gitlab/shared";
import { SourceCard } from "./SourceCard";
import { Markdown } from "./Markdown";
import { ResolvedMark } from "./ResolvedMark";
import { ResolveToggle } from "./ResolveToggle";
import { formatDateTime, formatDayTime } from "@/lib/format";
import type { T } from "@/lib/i18n/shared";
import { useT } from "@/components/I18nProvider";

const when = (iso: string | null) => (iso ? formatDateTime(iso) : "");
const full = (iso: string) => formatDayTime(iso, { year: true });

/** What a kind is, spelled out. */
const kindNames = (t: T): Record<GitlabKind, string> => ({ mr: t("Merge request"), comment: t("Comment"), branch: t("Branch") });

/** A GitLab state's colours: merged / resolved, closed, open / unresolved / draft. */
export const STATE_STYLE = (state: string) =>
  /merged|resolved/.test(state) && !/unresolved/.test(state)
    ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
    : /closed/.test(state)
      ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      : /unresolved|opened|draft/.test(state)
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * A GitLab comment's done mark: done when its thread is resolved in GitLab or it's marked here.
 * Toggling a thread resolves (or reopens) it in GitLab too; a plain comment is only marked here.
 * Nothing for merge requests and branches.
 */
export function GitlabResolve({ item, className = "" }: { item: Pick<GitlabItemView, "key" | "kind" | "state" | "resolvedAt">; className?: string }) {
  const t = useT();
  if (item.kind !== "comment") return null;
  const thread = item.state === "resolved" || item.state === "unresolved";
  return (
    <ResolveToggle
      done={gitlabDone(item)}
      onChange={(next) => setGitlabResolvedAction(item.key, next)}
      className={className}
      hint={
        thread
          ? { done: t("Resolved in GitLab — click: reopen it there (and here)"), open: t("Done — resolves the thread in GitLab too") }
          : undefined
      }
    />
  );
}

/**
 * The synced GitLab items these links point at, by link — looked up once per link (links that
 * aren't GitLab merge request, comment or branch links aren't asked about).
 */
export function useSyncedGitlabItems(urls: string[]): Record<string, GitlabItemView | null> {
  const [found, setFound] = useState<Record<string, GitlabItemView | null>>({});
  const ask = [...new Set(urls.filter((u) => gitlabLinkKey(u) && !(u in found)))].join("\n");
  useEffect(() => {
    if (!ask) return;
    let live = true;
    findGitlabItemsAction(ask.split("\n")).then((r) => {
      if (live) setFound((f) => ({ ...f, ...r }));
    });
    return () => {
      live = false;
    };
  }, [ask]);
  return found;
}

/**
 * A link to a synced GitLab item, shown as the item: what it is (a comment: whether it's done),
 * where, who and when. With `onToggle` a click unfolds it (the chevron); ↗ opens it in GitLab.
 * `resolved`: done by another account than its own (its copy in Jira).
 */
export function GitlabItemBadge({
  item,
  className = "",
  expanded = false,
  onToggle,
  resolved,
}: {
  item: GitlabItemView;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
  resolved?: boolean;
}) {
  const t = useT();
  const project = item.project.split("/").pop();
  const what = item.kind === "branch" ? item.ref : `${item.ref} ${item.title}`;
  // A branch that is on the remote (GitLab has it, or Zeff pushed it): with a check.
  const onRemote = item.kind === "branch" && item.state !== "not pushed";
  const start = item.kind === "comment" ? item.body.replace(/[`*_>#]+|!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim() : "";
  const icon = (
    <>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden={!onRemote} role={onRemote ? "img" : undefined}>
        {onRemote && <title>{t("On the remote")}</title>}
        {item.kind === "branch" ? (
          <>
            {onRemote && <path d="M12.5 15.5l2 2 3.5-4.25" />}
            <circle cx="6" cy="4.5" r="1.75" />
            <circle cx="6" cy="15.5" r="1.75" />
            <circle cx="14" cy="7" r="1.75" />
            <path d="M6 6.25v7.5M14 8.75c0 3-4.5 2.5-7.25 5.25" />
          </>
        ) : item.kind === "comment" ? (
          <path d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3h9.5a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 14.75 14H9l-3.5 3v-3h-.25A1.75 1.75 0 0 1 3.5 12.25z" />
        ) : (
          <>
            <circle cx="5.5" cy="4.5" r="1.75" />
            <circle cx="5.5" cy="15.5" r="1.75" />
            <circle cx="14.5" cy="15.5" r="1.75" />
            <path d="M5.5 6.25v7.5M14.5 13.75V8a2.5 2.5 0 0 0-2.5-2.5H9.5M11 3.75 9.25 5.5 11 7.25" />
          </>
        )}
      </svg>
    </>
  );
  const kind = gitlabKindLabels(t)[item.kind];
  const day = item.kind === "comment" ? item.createdAt : item.updatedAt;
  return (
    <SourceCard
      tone="orange"
      icon={icon}
      kind={kind}
      mark={item.kind === "comment" ? <ResolvedMark done={resolved || gitlabDone(item)} title={resolvedInGitlab(item) ? t("resolved in GitLab") : undefined} /> : undefined}
      state={item.state ? { text: item.state, className: STATE_STYLE(item.state) } : undefined}
      when={day ? when(day) : undefined}
      title={(item.kind === "branch" ? item.ref : item.kind === "mr" ? item.title : item.title || item.ref) || kind}
      sub={[project, item.kind === "comment" ? item.ref : item.kind === "mr" ? item.ref : "", item.author].filter(Boolean).join(" · ") || undefined}
      snippet={start || undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show all of it")}
      href={item.url}
      hrefTitle={t("Open in GitLab: {kind} {what} ({project})", { kind, what, project: item.project })}
      className={className}
    />
  );
}

/** A synced GitLab item in full, as a card: what it is and its state, its text, where, who and when. */
export function GitlabItemDetails({ item }: { item: GitlabItemView }) {
  const t = useT();
  const markdown = gitlabMarkdown(item);
  const row = (label: string, value: string | null | undefined, mono = false) =>
    value ? (
      <>
        <dt className="text-zinc-500">{label}</dt>
        <dd className={mono ? "font-mono" : ""}>{value}</dd>
      </>
    ) : null;
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          GitLab · {kindNames(t)[item.kind]}
          {item.state && <span className={`rounded px-1.5 py-0.5 font-medium ${STATE_STYLE(item.state)}`}>{item.state}</span>}
        </span>
        <span className="flex items-center gap-2">
          <GitlabResolve item={item} />
          <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open in GitLab")} ↗
          </a>
        </span>
      </div>
      <div className="font-medium leading-snug">
        {item.kind === "branch" ? <span className="font-mono">{item.ref}</span> : item.kind === "comment" ? t("On {ref} {title}", { ref: item.ref, title: item.title }) : `${item.ref} ${item.title}`}
      </div>
      {markdown.trim() && <Markdown text={markdown} className="text-zinc-700 dark:text-zinc-300" />}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {row(t("Project"), item.project, true)}
        {row(item.kind === "branch" ? t("Last commit by") : t("By"), item.author)}
        {row(item.kind === "branch" ? t("Committed") : t("Written"), item.createdAt ? full(item.createdAt) : null)}
        {item.kind === "mr" && item.updatedAt !== item.createdAt && row(t("Updated"), item.updatedAt ? full(item.updatedAt) : null)}
        {item.kind !== "branch" && row(t("Branch"), item.branch, true)}
      </dl>
    </div>
  );
}
