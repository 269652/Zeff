"use client";

import { useId, useState } from "react";
import { searchGitlabItemsAction } from "@/plugins/gitlab/server-actions";
import { searchMailsAction } from "@/app/actions";
import { searchTeamsMessagesAction } from "@/plugins/teams/server-actions";
import { searchTodosAction } from "@/plugins/todos/server-actions";
import { isChatFolder, mailLink, mailSender } from "@/lib/mail/shared";
import { todoKindLabels } from "@/lib/boards/shared";
import { todoLink, type Entity } from "@/lib/entities-shared";
import { gitlabDone, gitlabKindLabels, gitlabLinkKey, type GitlabKind } from "@/lib/gitlab/shared";
import { teamsKindLabel, teamsLinkKey } from "@/lib/teams/shared";
import { SearchIcon } from "./icons";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { useComboboxKeys, useLatestSearch } from "@/components/Combobox";

const when = (iso: string | null) => (iso ? formatDateTime(iso) : "");

/** A search hit: the message / item, and the link that points at it. */
export type Picked = Exclude<Entity, { source: "jira" | "jira-comment" | "work" | "time" }> & { url: string };

/** The GitLab sections' headings, by kind. */
const gitlabSection = (t: T): Record<GitlabKind, string> => ({ comment: t("GitLab comments"), mr: t("Merge requests"), branch: t("Branches") });

/** A pasted link rather than words. */
const isLink = (q: string) => /^(https?:|msteams:)/i.test(q.trim());

/** Which message / item a link points at, however it's written. */
const targetOf = (url: string) => gitlabLinkKey(url) ?? teamsLinkKey(url) ?? url.trim();

/** One hit, compact: what, where, who, when — and its first words. */
function Hit({ p, linked }: { p: Picked; linked: boolean }) {
  const t = useT();
  const meta =
    p.source === "teams"
      ? [p.teams.senderName ?? t("Someone"), p.teams.place, when(p.teams.sentAt), teamsKindLabel(p.teams, t)]
      : p.source === "mail"
        ? [isChatFolder(p.mail.folder) ? p.mail.folder : t("Mail"), mailSender(p.mail), when(p.mail.receivedAt), p.mail.unread ? t("unread") : ""]
        : p.source === "todo"
        ? [t("Todo {ref}", { ref: p.todo.ref }), p.todo.ticket, todoKindLabels(t)[p.todo.kind], p.todo.status === "done" ? when(p.todo.doneAt) : t("open")]
        : [gitlabKindLabels(t)[p.gitlab.kind], p.gitlab.project.split("/").pop(), p.gitlab.author, when(p.gitlab.kind === "comment" ? p.gitlab.createdAt : p.gitlab.updatedAt), p.gitlab.state];
  const words =
    p.source === "teams"
      ? [p.teams.subject, p.teams.text].filter(Boolean).join(" — ")
      : p.source === "mail"
        ? `${p.mail.subject} — ${p.mail.preview}`
        : p.source === "todo"
        ? p.todo.text
        : p.gitlab.kind === "branch"
          ? p.gitlab.ref
          : `${p.gitlab.ref} ${p.gitlab.title}${p.gitlab.kind === "comment" && p.gitlab.body ? ` — ${p.gitlab.body.replace(/\s+/g, " ")}` : ""}`;
  const done = (p.source === "teams" && p.teams.resolvedAt) || (p.source === "todo" && p.todo.status === "done") || (p.source === "gitlab" && gitlabDone(p.gitlab));
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span className="truncate">{meta.filter(Boolean).join(" · ")}</span>
        {done && <span className="shrink-0 rounded bg-emerald-100 px-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("done")}</span>}
        {linked && <span className="ml-auto shrink-0 font-medium text-emerald-600 dark:text-emerald-400">{t("✓ added")}</span>}
      </span>
      <span className="line-clamp-2 text-sm">{words || t("(no text)")}</span>
    </>
  );
}

/**
 * Add Teams messages, GitLab items (merge requests, comments, branches) and board todos (done
 * ones first) to a context item: one search across them — sender, chat, words, !number, branch,
 * T-12, or a pasted link (a merge request's brings its comments) — grouped by source; ↑/↓ and
 * Enter, or click. Each pick adds its link; the search clears for the next one.
 */
export function SourcePicker({ linked, onPick }: { linked: Set<string>; onPick: (p: Picked) => void }) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // (Answers that come back after a newer search are dropped.)
  const {
    result: hits,
    setResult: setHits,
    search,
    busy: pending,
  } = useLatestSearch<Picked[] | null>(
    async (text) => {
      // How many of each comes from the server: a few of every kind for words, a pasted link's all.
      const [teams, gitlab, todos, mails] = await Promise.all([
        searchTeamsMessagesAction(text),
        searchGitlabItemsAction(text),
        isLink(text) ? [] : searchTodosAction(text),
        isLink(text) ? [] : searchMailsAction(text),
      ]);
      return [
        // Done todos first: the work an entry is about.
        ...todos.map((todo): Picked => ({ source: "todo", todo, url: todoLink(todo.id) })),
        ...teams.map((m): Picked => ({ source: "teams", teams: m, url: m.link })),
        ...mails.map((m): Picked => ({ source: "mail", mail: m, url: mailLink(m.key) })),
        ...gitlab.map((g): Picked => ({ source: "gitlab", gitlab: g, url: g.url })),
      ];
    },
    null,
    {
      delay: 250,
      onResult: () => {
        keys.reset();
        setOpen(true);
      },
    },
  );
  const pick = (p: Picked) => {
    if (!linked.has(p.url)) onPick(p);
    setQ("");
    setOpen(false);
    setHits(null);
  };
  const keys = useComboboxKeys({ count: hits?.length ?? 0, open, setOpen, onPick: (i) => hits && pick(hits[i]), wrap: true, start: 0, ignoreClosed: true });
  const { active, setActive, listId } = keys;

  // Sections in the order the hits come (so ↑/↓ follows what's shown): todos, Teams, then GitLab
  // by kind — or, for a pasted link, what it points at with its merge request's family, together.
  const sections: { label: string; items: { p: Picked; i: number }[] }[] = [];
  (hits ?? []).forEach((p, i) => {
    const label =
      p.source === "teams"
        ? "Teams"
        : p.source === "mail"
          ? t("Mails")
          : p.source === "todo"
            ? t("Todos")
            : isLink(q)
              ? "GitLab"
              : gitlabSection(t)[p.gitlab.kind];
    const last = sections[sections.length - 1];
    if (last?.label === label) last.items.push({ p, i });
    else sections.push({ label, items: [{ p, i }] });
  });
  // A pasted comment link that isn't synced (yet) finds its merge request — say so.
  const missing = isLink(q) && !!hits?.length && !hits.some((h) => targetOf(h.url) === targetOf(q));

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={id}>
        {t("Add from Teams, mail, GitLab or your todos")}
      </label>
      <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
      <input
        id={id}
        className="input pl-8"
        placeholder={t("Add from Teams, mail, GitLab or your todos — sender, chat, words, !169, T-12 or a link…")}
        value={q}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={keys.activeDescendant}
        onChange={(e) => {
          setQ(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => (hits ? setOpen(true) : search(q))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={keys.onKeyDown}
      />
      {pending && <span className="absolute top-2 right-3 text-xs text-zinc-400">…</span>}
      {open && hits && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">
              {isLink(q)
                ? t("That link isn't synced (yet) — sync on the Teams or GitLab page.")
                : t("Nothing synced matches — sync on the Teams or GitLab page.")}
            </li>
          ) : (
            [
              missing && (
                <li key="missing" role="presentation" className="px-3 pt-1.5 pb-1 text-xs text-amber-700 dark:text-amber-400">
                  {t("That comment isn't synced (yet) — sync on the GitLab page. Its merge request:")}
                </li>
              ),
              ...sections.map((g) =>
                g.items.length ? (
                  <li key={g.label} role="presentation">
                    <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{g.label}</div>
                    <ul role="presentation">
                      {g.items.map(({ p, i }) => (
                        <li
                          key={p.url}
                          id={keys.optionId(i)}
                          role="option"
                          aria-selected={i === active}
                          aria-disabled={linked.has(p.url)}
                          className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"} ${linked.has(p.url) ? "opacity-60" : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => pick(p)}
                        >
                          <Hit p={p} linked={linked.has(p.url)} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null,
              ),
            ]
          )}
        </ul>
      )}
    </div>
  );
}
