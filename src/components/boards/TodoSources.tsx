"use client";

import { ChatIcon } from "@/components/MailBadge";
import { mergeJiraNotes, sourceKey, todoRef, type SyncedComment, type TodoSource, type TodoUserNote, type TodoView } from "@/lib/todos/shared";
import { NoteBadge, NoteRow } from "./NoteBadge";
import { DismissButton } from "../DismissButton";
import { SourceBadge, SourceDetails } from "../SourceBadge";
import { entityWhoWhen } from "@/lib/entities-shared";
import { groupOfKind, sourceKindOf, type ContextSummary } from "@/lib/context-summary";
import { HoverCard } from "../HoverCard";
import { CollapseIcon, ExpandIcon, NoteIcon, SparkIcon } from "../icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import { dismissTodoContextAction } from "@/plugins/todos/server-actions";
import { latestPerKind, ShowMoreToggle } from "../ShowMore";
import { ContentLightbox } from "../ContentLightbox";
import { ScaledBox } from "../ScaledBox";
import { useT } from "../I18nProvider";
import type { T } from "@/lib/i18n/shared";

/** A message Zeff synced to Jira: its comment there, as a small link beside the badge. */
function SyncedMark({ s }: { s: SyncedComment }) {
  const t = useT();
  const text = `✓ Jira${s.ticket ? ` ${s.ticket}` : ""}`;
  const title = s.ticket
    ? s.resolved
      ? t("Synced to Jira by Zeff as a comment on {ticket} — done there", { ticket: s.ticket })
      : t("Synced to Jira by Zeff as a comment on {ticket}", { ticket: s.ticket })
    : s.resolved
      ? t("Synced to Jira by Zeff as a comment — done there")
      : t("Synced to Jira by Zeff as a comment");
  return s.url ? (
    <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 self-center text-xs font-medium whitespace-nowrap text-sky-700 hover:underline dark:text-sky-400" title={title}>
      {text}
    </a>
  ) : (
    <span className="shrink-0 self-center text-xs font-medium whitespace-nowrap text-sky-700 dark:text-sky-400" title={title}>
      {text}
    </span>
  );
}

/** A Jira comment Zeff wrote — the action of a todo: its mark beside the badge. */
function PostedMark({ by }: { by: { todoId: number; text: string } }) {
  const t = useT();
  return (
    <span className="shrink-0 self-center text-xs font-medium whitespace-nowrap text-sky-700 dark:text-sky-400" title={t("Posted by Zeff as the action of {ref}: {text}", { ref: todoRef(by.todoId), text: by.text })}>
      ✓ {todoRef(by.todoId)}
    </span>
  );
}

/** Below a Jira comment Zeff wrote: which todo's action it was. */
function PostedNote({ by }: { by: { todoId: number; text: string } }) {
  const t = useT();
  return (
    <p className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      ✓ {t("Posted by Zeff — the action of {ref}", { ref: todoRef(by.todoId) })}: {by.text}
    </p>
  );
}

/** Below a synced message's card: where its copy in Jira is. */
function SyncedNote({ s }: { s: SyncedComment }) {
  const t = useT();
  return (
    <p className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      ✓ {s.ticket ? t("Synced to Jira by Zeff — comment on {ticket}", { ticket: s.ticket }) : t("Synced to Jira by Zeff")}
      {s.url && (
        <>
          {" "}
          <a href={s.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {t("open")} ↗
          </a>
        </>
      )}
    </p>
  );
}

/** A todo's context items (what it came from, the notes), newest first — and how many are new since you last opened them. */
export function useContextItems(list: TodoSource[], notes: TodoUserNote[], todoId?: number) {
  // Its notes — yours and the runs' reports — among what it came from, as context like the rest.
  // Newest first, whatever kind.
  const merged = mergeJiraNotes(list, notes);
  const items: Item[] = [...merged.sources.map((s): Item => ({ s })), ...merged.notes.map((m): Item => ({ n: m.n, ...(m.jira ? { jira: m.jira } : {}) }))]
    .map((it) => ({ it, t: Date.parse(normal(itemKind(it).at)) || 0 }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.it);
  // What came since you last opened them (in this browser): counted on the toggle.
  const seenRaw = useSyncExternalStore(subscribeSeen, readSeenRaw, () => null);
  useEffect(() => {
    if (readSeenRaw() === "") writeSeen({ since: new Date().toISOString(), todos: {} }); // from now on
  }, []);
  const seen = parseSeen(seenRaw);
  const since = todoId !== undefined && seen ? Date.parse(seen.todos[todoId] ?? seen.since) : NaN;
  const unread = Number.isNaN(since) ? 0 : items.filter((it) => Date.parse(normal(itemKind(it).at)) > since).length;
  const markSeen = () => {
    if (todoId !== undefined && seen) writeSeen({ ...seen, todos: { ...seen.todos, [todoId]: new Date().toISOString() } });
  };
  return { items, unread, markSeen };
}

/** A toggle in a todo's row of toggles ("Context", "Actions", "Knowledge"): it unfolds its area below the row. */
export function AreaToggle({ open, onToggle, label, tone = "indigo", title, children }: { open: boolean; onToggle: () => void; label: string; tone?: "indigo" | "violet" | "emerald"; title?: string; children?: React.ReactNode }) {
  // A quiet chip: the colour only in its icons, the chip itself neutral (darker while open).
  const color = tone === "violet" ? "[&_svg]:text-violet-600 dark:[&_svg]:text-violet-400" : tone === "emerald" ? "[&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400" : "[&_svg]:text-indigo-500 dark:[&_svg]:text-indigo-400";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border px-2 py-0.5 text-left text-xs font-medium transition ${open ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"} ${color}`}
      aria-expanded={open}
      title={title}
    >
      {open ? <CollapseIcon className="size-3 !text-zinc-400" /> : <ExpandIcon className="size-3 !text-zinc-400" />}
      <span>{label}</span>
      {children}
    </button>
  );
}

/**
 * What a closed context holds, at a glance (the toggle's hovercard): the newest few, the rest counted.
 * `group`: only that kind (the icon under the pointer — Mail, WhatsApp …); none: all of it.
 */
function ContextPreview({ items, unread, group }: { items: Item[]; unread: number; group?: string | null }) {
  const t = useT();
  const kind = group ? CONTEXT_GROUPS.find((g) => g.group === group) : undefined;
  items = kind ? items.filter((it) => groupOf(itemKind(it).kind) === kind.group) : items;
  const shown = items.slice(0, kind ? 8 : 6);
  return (
    <div className="space-y-1.5 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300">
        {kind?.icon}
        <span>
          {kind
            ? items.length === 1
              ? t("{kind} — 1 item", { kind: kind.label(t) })
              : t("{kind} — {n} items", { kind: kind.label(t), n: items.length })
            : items.length === 1
              ? t("Context — 1 item")
              : t("Context — {n} items", { n: items.length })}
          {!kind && unread > 0 && `, ${t("{n} new", { n: unread })}`}
        </span>
      </p>
      <span className="flex min-w-0 flex-col items-stretch gap-1">
        {shown.map((it) => ("n" in it ? <NoteBadge key={`note:${it.n.from ?? ""}:${it.n.at}`} n={it.n} className="max-w-full min-w-0" /> : <SourceBadge key={sourceKey(it.s)} entity={it.s} className="max-w-full min-w-0" />))}
      </span>
      {items.length > shown.length && <p className="text-zinc-500">{kind ? t("… and {n} more — click for the whole context", { n: items.length - shown.length }) : t("… and {n} more — click for all", { n: items.length - shown.length })}</p>}
    </div>
  );
}

/** The context toggle: "Context (12 · 3 new)" and its kinds as small icons with numbers; hover it for the newest — an icon for just its kind (the mail icon: the mails). */
export function ContextToggle({ items, unread, open, onToggle }: { items: Item[]; unread: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  // The kind whose icon the pointer is on: the hovercard shows just that kind (none: all).
  const [group, setGroup] = useState<string | null>(null);
  if (!items.length) return null;
  const toggle = (
    <AreaToggle
      open={open}
      onToggle={onToggle}
      label={
        unread > 0 && !open ? t("Context ({n} · {unread} new)", { n: items.length, unread }) : t("Context ({n})", { n: items.length })
      }
      title={unread > 0 && !open ? t("New since you last opened them") : undefined}
    >
      <ContextCounts items={items} onHover={setGroup} />
    </AreaToggle>
  );
  return open ? toggle : <HoverCard card={<ContextPreview items={items} unread={unread} group={group} />}>{toggle}</HoverCard>;
}

/** The context itself: of each kind the latest three — the rest behind "Show more"; hover one for all of it. */
/** A source in a todo's context: its badge, what Zeff did with it — and, from the badge's title, all of it in a lightbox. */
function ContextSource({ s, todoId }: { s: TodoSource; todoId?: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const posted = s.source === "jira-comment" ? s.comment.postedBy : undefined;
  const synced = s.source === "jira-comment" || s.source === "keep" || s.source === "fact" || s.source === "document" || s.source === "calendar" ? undefined : s.synced;
  return (
    <span className="group relative flex w-full flex-col items-stretch gap-1">
      <SourceBadge entity={s} className="min-w-0 flex-1" resolved={synced?.resolved || undefined} onToggle={() => setOpen(true)} />
      {(synced || posted) && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1">
          {synced && <SyncedMark s={synced} />}
          {posted && <PostedMark by={posted} />}
        </span>
      )}
      <ContentLightbox open={open} onClose={() => setOpen(false)} label={t("Context")}>
        <SourceDetails entity={s} />
        {synced && <SyncedNote s={synced} />}
        {posted && <PostedNote by={posted} />}
      </ContentLightbox>
      {todoId !== undefined && (
        <DismissButton
          className="absolute top-2 right-2 rounded-full bg-white/90 shadow-sm [@media(hover:none)]:opacity-100 group-focus-within:opacity-100 dark:bg-zinc-900/90"
          onDismiss={() => dismissTodoContextAction(todoId, sourceKey(s))}
          title={t("Dismiss — takes it out of this todo's context for good")}
          label={t("Dismiss this context item")}
        />
      )}
    </span>
  );
}

/** How many columns the context cards stand in. */
const CONTEXT_COLUMNS = 4;

export function ContextList({ items, todoId }: { items: Item[]; todoId?: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const { shown, hidden } = latestPerKind(items, itemKind, all);
  return (
    <span className="flex w-full flex-col items-start gap-2">
      {/* Four columns in a row across the whole width (each a column of cards, dealt out in turn), 20% smaller than the page (text, padding, pictures). */}
      <ScaledBox className="w-full">
        <div className="flex w-full items-start gap-3">
          {Array.from({ length: CONTEXT_COLUMNS }, (_, c) => (
            <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
              {shown
                .filter((_, i) => i % CONTEXT_COLUMNS === c)
                .map((it) =>
                  "n" in it ? (
                    <NoteRow key={`note:${it.n.from ?? ""}:${it.n.at}`} n={it.n} jira={it.jira} todoId={todoId} />
                  ) : (
                    <ContextSource key={sourceKey(it.s)} s={it.s} todoId={todoId} />
                  ),
                )}
            </div>
          ))}
        </div>
      </ScaledBox>
      <ShowMoreToggle hidden={hidden} open={all} onToggle={() => setAll(!all)} />
    </span>
  );
}

/**
 * What a todo came from — Jira comments, Teams messages, GitLab comments, mails, the notes — as
 * badges, folded behind its toggle; hover (or focus) one for all of it, and to mark it done.
 */
export function TodoSources({ list, notes = [], todoId, startOpen = false }: { list: TodoSource[]; notes?: TodoUserNote[]; todoId?: number; /** Unfolded from the start (it was opened to be fetched). */ startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const { items, unread, markSeen } = useContextItems(list, notes, todoId);
  if (!items.length) return null;
  return (
    <span className="mt-1 flex flex-col items-start gap-1">
      <ContextToggle
        items={items}
        unread={unread}
        open={open}
        onToggle={() => {
          if (!open) markSeen();
          setOpen(!open);
        }}
      />
      {open && <ContextList items={items} todoId={todoId} />}
    </span>
  );
}

/**
 * A todo's whole context, as one list: what it came from, the mails about its ticket since it came
 * up, your notes and the runs' reports (its own and related todos') — on Todos and Work alike.
 */
export function TodoContext({ t, cameFrom }: { t: Pick<TodoView, "id" | "userNotes" | "relatedNotes">; cameFrom: TodoSource[] }) {
  const list = cameFrom;
  const notes = [...t.userNotes, ...(t.relatedNotes ?? [])];
  if (!list.length && !notes.length) return null;
  return <TodoSources list={list} notes={notes} todoId={t.id} />;
}

export type Item = { s: TodoSource } | { n: TodoUserNote; /** The Jira comment this note became (it was synced to Jira) — one entry with both. */ jira?: TodoSource };

// When you last opened each todo's comments (this browser): { since: first visit, todos: { id: when } }.
const SEEN_KEY = "zeff-sources-seen";
const SEEN_EVENT = "zeff-sources-seen";
type Seen = { since: string; todos: Record<string, string> };
function readSeenRaw(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function parseSeen(raw: string | null): Seen | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Seen;
    return v && typeof v.since === "string" ? { since: v.since, todos: v.todos ?? {} } : null;
  } catch {
    return null;
  }
}
function writeSeen(v: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(v));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}
function subscribeSeen(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(SEEN_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SEEN_EVENT, cb);
  };
}
/** "2026-10-08 12:00:00" (UTC, as SQLite keeps it) or ISO: something Date.parse reads alike. */
const normal = (at: string) => (at && !at.includes("T") ? `${at.replace(" ", "T")}Z` : at);

/** The kinds of context, as the badges show them: icon (in the badge's colour), label. */
const iconProps = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const CONTEXT_GROUPS: { group: string; label: (t: T) => string; icon: React.ReactNode }[] = [
  { group: "teams", label: () => "Teams", icon: <svg {...iconProps} className="size-3.5 text-violet-600 dark:text-violet-400"><path d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3h9.5a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 14.75 14H9l-3.5 3v-3h-.25A1.75 1.75 0 0 1 3.5 12.25z" /></svg> },
  { group: "mail", label: (t) => t("Mail"), icon: <svg {...iconProps} className="size-3.5 text-sky-600 dark:text-sky-400"><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="m3 5.5 7 5.25 7-5.25" /></svg> },
  { group: "whatsapp", label: () => "WhatsApp", icon: <ChatIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" /> },
  { group: "signal", label: () => "Signal", icon: <ChatIcon className="size-3.5 text-blue-600 dark:text-blue-400" /> },
  { group: "jira", label: () => "Jira", icon: <svg {...iconProps} className="size-3.5 text-jira-500 dark:text-jira-400"><path d="M4 4.5h12v8.5H9.5L6 16v-3H4z" /></svg> },
  { group: "gitlab", label: () => "GitLab", icon: <svg {...iconProps} className="size-3.5 text-orange-600 dark:text-orange-400"><circle cx="6" cy="4.5" r="1.75" /><circle cx="6" cy="15.5" r="1.75" /><circle cx="14" cy="7" r="1.75" /><path d="M6 6.25v7.5M14 8.75c0 3-8 2.5-8 5" /></svg> },
  { group: "note", label: (t) => t("Notes"), icon: <NoteIcon className="size-3.5 text-indigo-600 dark:text-indigo-400" /> },
  { group: "report", label: (t) => t("AI reports"), icon: <SparkIcon className="size-3.5 text-violet-600 dark:text-violet-400" /> },
];
const groupOf = groupOfKind;

/** How much of each kind of context there is: small icons with numbers (5 Teams, 4 Mail, 3 Jira …). */
function ContextCounts({ items, onHover }: { items: Item[]; onHover?: (group: string | null) => void }) {
  const counts: Record<string, number> = {};
  for (const it of items) {
    const g = groupOf(itemKind(it).kind);
    counts[g] = (counts[g] ?? 0) + 1;
  }
  // A branch among the GitLab items is on the remote (GitLab has it, or Zeff pushed it): its icon gets a green check.
  const remote = items.some((it) => !("n" in it) && it.s.source === "gitlab" && it.s.gitlab.kind === "branch" && it.s.gitlab.state !== "not pushed");
  return <ContextCountsView groups={counts} remote={remote} onHover={onHover} />;
}

/** The same from a summary alone (a table row before its context is fetched). */
export function ContextCountsView({ groups, remote, onHover }: { groups: Record<string, number>; remote: boolean; onHover?: (group: string | null) => void }) {
  const t = useT();
  const shown = CONTEXT_GROUPS.filter((g) => groups[g.group]);
  if (!shown.length) return null;
  return (
    <span className="ml-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-normal text-zinc-500 dark:text-zinc-400">
      {shown.map((g) => (
        <span key={g.group} className="flex items-center gap-0.5 tabular-nums" title={`${groups[g.group]} ${g.label(t)}`} onMouseEnter={() => onHover?.(g.group)} onMouseLeave={() => onHover?.(null)}>
          {g.group === "gitlab" && remote ? (
            <span className="relative flex" title={t("Branch on the remote")}>
              {g.icon}
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="absolute -right-1 -bottom-1 size-2.5 rounded-full bg-white text-emerald-600 dark:bg-zinc-900 dark:text-emerald-400" aria-hidden>
                <path d="m4.5 10.5 3.5 3.5 7.5-8" />
              </svg>
            </span>
          ) : (
            g.icon
          )}
          {groups[g.group]}
        </span>
      ))}
    </span>
  );
}

/** The toggle of a context that isn't loaded yet: "Context (12)" and its kinds — `onOpen` fetches it. */
export function ContextSummaryToggle({ summary, onOpen, loading }: { summary: ContextSummary; onOpen: () => void; loading?: boolean }) {
  const t = useT();
  return (
    <AreaToggle open={false} onToggle={onOpen} label={loading ? t("Loading …") : t("Context ({n})", { n: summary.n })}>
      <ContextCountsView groups={summary.groups} remote={summary.remote} />
    </AreaToggle>
  );
}

const itemKind = (it: Item) => ("n" in it ? { kind: it.n.by ? "report" : "note", at: it.n.at } : sourceKind(it.s));

/** A source's kind (Teams, Jira comment, mail, GitLab comment, MR, branch) and when it was written. */
function sourceKind(s: TodoSource): { kind: string; at: string } {
  // A chat's message counts as WhatsApp (Signal), not as mail (the mail sync reads them all).
  return { kind: sourceKindOf(s), at: entityWhoWhen(s).at ?? "" };
}
