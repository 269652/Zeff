"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createContextAction, fetchImagesAction } from "@/app/actions";
import { isRemoteImage } from "@/lib/contexts-shared";
import { gitlabHeadline, gitlabKindLabels, gitlabMarkdown, gitlabTicket, type GitlabItemView } from "@/lib/gitlab/shared";
import { imageTargets, mapImageTargets } from "@/lib/markdown";
import { teamsDay } from "@/lib/teams/shared";
import { CONTEXT_KIND_STYLE } from "./contextKindStyle";
import { GitlabResolve, STATE_STYLE } from "./GitlabItemBadge";
import { Markdown } from "./Markdown";
import { base64File, pasteToken } from "./MarkdownPasteField";
import { currentLocale, formatDate, formatTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const when = (iso: string | null) =>
  iso ? `${formatDate(iso)}, ${formatTime(iso)}` : "";

/** One item: what and where, who and when, its text as Markdown (long ones fold) — and what to do with it. */
function GitlabItemCard({ item, prefixes }: { item: GitlabItemView; prefixes: Set<string> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const markdown = gitlabMarkdown(item);
  const long = markdown.length > 600 || markdown.split("\n").length > 10;
  const at = item.kind === "comment" ? item.createdAt : item.updatedAt;

  /** A context item (from GitLab) with the text, its link and ticket — GitLab's pictures in it fetched to keep. */
  const addAsContext = () =>
    start(async () => {
      const fd = new FormData();
      let body = markdown;
      const pictures = imageTargets(markdown).filter(isRemoteImage);
      let n = 0;
      if (pictures.length) {
        for (const g of await fetchImagesAction(pictures)) {
          if (!g.ok) continue;
          const token = pasteToken();
          fd.append(`pasted-file-${n}`, base64File(g.data, g.name, g.mime), g.name);
          fd.set(`pasted-token-${n}`, token);
          body = mapImageTargets(body, (target) => (target === g.url ? `paste:${token}` : target));
          n++;
        }
      }
      fd.set("pastedCount", String(n));
      fd.set("kind", "gitlab");
      fd.set("author", item.author ?? "");
      fd.set("date", at ? teamsDay(at) : "");
      fd.set("title", gitlabHeadline(item, t));
      fd.set("body", body);
      fd.set("ticket", gitlabTicket(item, prefixes) ?? "");
      fd.set("linkCount", "1");
      fd.set("link-url-0", item.url);
      const r = await createContextAction(null, null, fd);
      setAdded(r?.ok ? "ok" : (r?.error ?? t("Couldn't add it.")));
    });

  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${CONTEXT_KIND_STYLE.gitlab}`}>{gitlabKindLabels(t)[item.kind]}</span>
        <span className="font-mono">{item.project.split("/").pop()}</span>
        {item.author && <span className="font-medium text-zinc-700 dark:text-zinc-200">{item.author}</span>}
        {at && <span title={new Date(at).toLocaleString(currentLocale())}>{when(at)}</span>}
        {item.state && <span className={`rounded px-1.5 py-0.5 font-medium ${STATE_STYLE(item.state)}`}>{item.state}</span>}
        <span className="ml-auto flex items-center gap-2">
          <GitlabResolve item={item} />
          {item.inContext && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✓ {t("in Context")}</span>}
          <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open in GitLab")} ↗
          </a>
        </span>
      </header>
      <h3 className="mt-1.5 text-sm font-semibold">
        {item.kind === "branch" ? <span className="font-mono">{item.ref}</span> : item.kind === "comment"
            ? t("On {ref} {title}", { ref: item.ref, title: item.title })
            : `${item.ref} ${item.title}`}
      </h3>
      {markdown.trim() && (
        <div className="mt-1">
          <div className={`relative ${long && !open ? "max-h-48 overflow-hidden" : ""}`}>
            <Markdown text={markdown} className="text-zinc-700 dark:text-zinc-300" />
            {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white dark:from-zinc-900" aria-hidden />}
          </div>
          {long && (
            <button type="button" className="mt-0.5 text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(!open)}>
              {open ? t("Show less") : t("Show more")}
            </button>
          )}
        </div>
      )}
      <footer className="mt-2 flex flex-wrap items-center gap-2">
        {added === "ok" ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {t("Added — find it in")}{" "}
            <Link href="/context" className="underline">
              {t("Context")}
            </Link>{" "}
            {t("to link it to entries.")}
          </span>
        ) : (
          <>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={addAsContext} title={t("Keep it as a context item (from GitLab, with its link), to link to entries")}>
              {pending ? t("Adding…") : t("Add as context")}
            </button>
            {added && <span className="text-xs text-red-600 dark:text-red-400">{added}</span>}
          </>
        )}
      </footer>
    </article>
  );
}

/** The synced GitLab items, most recently updated first. `ticketPrefixes`: the Jira projects you book ("PROJ"). */
export function GitlabItemList({ items, ticketPrefixes }: { items: GitlabItemView[]; ticketPrefixes: string[] }) {
  const prefixes = new Set(ticketPrefixes);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <GitlabItemCard key={item.key} item={item} prefixes={prefixes} />
      ))}
    </div>
  );
}
