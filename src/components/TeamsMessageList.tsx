"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createContextAction } from "@/app/actions";
import { setTeamsResolvedAction } from "@/plugins/teams/server-actions";
import { teamsDay, teamsKindLabel, teamsMarkdown, type TeamsMessageView } from "@/lib/teams/shared";
import { CONTEXT_KIND_STYLE } from "./contextKindStyle";
import { Markdown } from "./Markdown";
import { ResolveToggle } from "./ResolveToggle";
import { useIsClient } from "./useIsClient";
import { currentLocale, formatDate, formatTime } from "@/lib/format";

const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

/** One message: who, where, when, what — the text as Markdown (long ones fold) — and what to do with it. */
function TeamsMessageCard({ m }: { m: TeamsMessageView }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // The HTML → Markdown conversion needs the browser (DOMParser): plain text until then.
  const client = useIsClient();
  const { markdown, pictures } = client ? teamsMarkdown(m.html) : { markdown: m.text, pictures: 0 };
  const long = markdown.length > 600 || markdown.split("\n").length > 10;

  /** A context item (from Teams) with the message — to link to entries from there. */
  const addAsContext = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("kind", "teams");
      fd.set("author", m.senderName ?? "");
      fd.set("date", teamsDay(m.sentAt));
      fd.set("title", m.subject ?? "");
      fd.set("body", markdown + (pictures ? `\n\n_(${pictures === 1 ? "A picture" : `${pictures} pictures`} — see the message in Teams)_` : ""));
      fd.set("linkCount", "1");
      fd.set("link-url-0", m.link);
      const r = await createContextAction(null, null, fd);
      setAdded(r?.ok ? "ok" : (r?.error ?? "Couldn't add it."));
    });

  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${CONTEXT_KIND_STYLE.teams}`}>{teamsKindLabel(m)}</span>
        {m.senderName && <span className="font-medium text-zinc-700 dark:text-zinc-200">{m.senderName}</span>}
        {m.place && <span>in {m.place}</span>}
        <span title={new Date(m.sentAt).toLocaleString(currentLocale())}>{when(m.sentAt)}</span>
        {m.kind === "mention" && m.isRead === false && <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">unread</span>}
        <span className="ml-auto flex items-center gap-2">
          {m.inContext && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">✓ in Context</span>}
          <ResolveToggle done={!!m.resolvedAt} onChange={(next) => setTeamsResolvedAction(m.key, next)} />
          <a href={m.link} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Open in Teams ↗
          </a>
        </span>
      </header>
      {m.subject && <h3 className="mt-1.5 text-sm font-semibold">{m.subject}</h3>}
      <div className="mt-1">
        <div className={`relative ${long && !open ? "max-h-48 overflow-hidden" : ""}`}>
          {markdown ? <Markdown text={markdown} className="text-zinc-700 dark:text-zinc-300" /> : <p className="text-sm text-zinc-400">(no text)</p>}
          {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white dark:from-zinc-900" aria-hidden />}
        </div>
        {long && (
          <button type="button" className="mt-0.5 text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show more"}
          </button>
        )}
        {pictures > 0 && <p className="mt-1 text-xs text-zinc-400">{pictures === 1 ? "A picture" : `${pictures} pictures`} — open the message in Teams to see {pictures === 1 ? "it" : "them"}.</p>}
      </div>
      <footer className="mt-2 flex flex-wrap items-center gap-2">
        {added === "ok" ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Added — find it in <Link href="/context" className="underline">Context</Link> to link it to entries.
          </span>
        ) : (
          <>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={addAsContext} title="Keep it as a context item (from Teams, with its link), to link to entries">
              {pending ? "Adding…" : "Add as context"}
            </button>
            {added && <span className="text-xs text-red-600 dark:text-red-400">{added}</span>}
          </>
        )}
      </footer>
    </article>
  );
}

/** The synced Teams messages, newest first. */
export function TeamsMessageList({ messages }: { messages: TeamsMessageView[] }) {
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <TeamsMessageCard key={m.key} m={m} />
      ))}
    </div>
  );
}
