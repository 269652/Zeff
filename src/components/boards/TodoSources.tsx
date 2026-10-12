"use client";

import { ChatIcon } from "@/components/MailBadge";
import { mergeJiraNotes, sourceKey, type SyncedComment, type TodoSource, type TodoUserNote, type TodoView } from "@/lib/boards/shared";
import { NoteBadge, NoteRow } from "./NoteBadge";
import { DismissButton } from "../DismissButton";
import { SourceBadge, SourceDetails } from "../SourceBadge";
import { entityWhoWhen } from "@/lib/entities-shared";
import { HoverCard } from "../HoverCard";
import { CollapseIcon, ExpandIcon, NoteIcon, SparkIcon } from "../icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import { dismissTodoContextAction } from "@/plugins/todos/server-actions";
import { latestPerKind, ShowMoreToggle } from "../ShowMore";
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
    <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 self-center text-[11px] font-medium whitespace-nowrap text-sky-700 hover:underline dark:text-sky-400" title={title}>
      {text}
    </a>
  ) : (
    <span className="shrink-0 self-center text-[11px] font-medium whitespace-nowrap text-sky-700 dark:text-sky-400" title={title}>
      {text}
    </span>
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

/** A toggle in a todo's row of toggles ("Show context", "Show actions"): it unfolds its area below the row. */
export function AreaToggle({ open, onToggle, label, tone = "indigo", title, children }: { open: boolean; onToggle: () => void; label: string; tone?: "indigo" | "violet" | "emerald"; title?: string; children?: React.ReactNode }) {
  const color = tone === "violet" ? "text-violet-700 dark:text-violet-300" : tone === "emerald" ? "text-emerald-700 dark:text-emerald-300" : "text-indigo-600 dark:text-indigo-400";
  return (
    <button type="button" onClick={onToggle} className={`flex items-center gap-1 text-xs font-medium hover:underline ${color}`} aria-expanded={open} title={title}>
      {open ? <CollapseIcon className="size-3.5" /> : <ExpandIcon className="size-3.5" />}
      <span>{label}</span>
      {children}
    </button>
  );
}

/** What a closed context holds, at a glance (the toggle's hovercard): the newest few, the rest counted. */
function ContextPreview({ items, unread }: { items: Item[]; unread: number }) {
  const t = useT();
  const shown = items.slice(0, 6);
  return (
    <div className="space-y-1.5 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 text-xs">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">
        {items.length === 1 ? t("Context — 1 item") : t("Context — {n} items", { n: items.length })}
        {unread > 0 && `, ${t("{n} new", { n: unread })}`}
      </p>
      <span className="flex min-w-0 flex-col items-stretch gap-1">
        {shown.map((it) => ("n" in it ? <NoteBadge key={`note:${it.n.from ?? ""}:${it.n.at}`} n={it.n} className="max-w-full min-w-0" /> : <SourceBadge key={sourceKey(it.s)} entity={it.s} className="max-w-full min-w-0" />))}
      </span>
      {items.length > shown.length && <p className="text-zinc-500">{t("… and {n} more — click for all", { n: items.length - shown.length })}</p>}
    </div>
  );
}

/** The context toggle: "Show context (12 · 3 neu)" and its kinds as small icons with numbers; hover it for the newest. */
export function ContextToggle({ items, unread, open, onToggle }: { items: Item[]; unread: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  if (!items.length) return null;
  const toggle = (
    <AreaToggle
      open={open}
      onToggle={onToggle}
      label={
        open
          ? t("Hide context ({n})", { n: items.length })
          : unread > 0
            ? t("Show context ({n} · {unread} new)", { n: items.length, unread })
            : t("Show context ({n})", { n: items.length })
      }
      title={unread > 0 && !open ? t("New since you last opened them") : undefined}
    >
      <ContextCounts items={items} />
    </AreaToggle>
  );
  return open ? toggle : <HoverCard card={<ContextPreview items={items} unread={unread} />}>{toggle}</HoverCard>;
}

/** The context itself: of each kind the latest three — the rest behind "Show more"; hover one for all of it. */
export function ContextList({ items, todoId }: { items: Item[]; todoId?: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const { shown, hidden } = latestPerKind(items, itemKind, all);
  return (
    <span className="flex flex-col items-start gap-1">
      {shown.map((it) => {
        if ("n" in it) return <NoteRow key={`note:${it.n.from ?? ""}:${it.n.at}`} n={it.n} jira={it.jira} todoId={todoId} />;
        const s = it.s;
        const synced = s.source === "jira-comment" || s.source === "keep" || s.source === "fact" || s.source === "document" ? undefined : s.synced;
        return (
          <HoverCard
            key={sourceKey(s)}
            className="group gap-1.5 sm:max-w-md"
            card={
              <div>
                <SourceDetails entity={s} />
                {synced && <SyncedNote s={synced} />}
              </div>
            }
          >
            <SourceBadge entity={s} className="min-w-0" resolved={synced?.resolved || undefined} />
            {synced && <SyncedMark s={synced} />}
            {todoId !== undefined && <DismissButton onDismiss={() => dismissTodoContextAction(todoId, sourceKey(s))} title={t("Dismiss — takes it out of this todo's context for good")} label={t("Dismiss this context item")} />}
          </HoverCard>
        );
      })}
      <ShowMoreToggle hidden={hidden} open={all} onToggle={() => setAll(!all)} />
    </span>
  );
}

/**
 * What a todo came from — Jira comments, Teams messages, GitLab comments, mails, the notes — as
 * badges, folded behind its toggle; hover (or focus) one for all of it, and to mark it done.
 */
export function TodoSources({ list, notes = [], todoId }: { list: TodoSource[]; notes?: TodoUserNote[]; todoId?: number }) {
  const [open, setOpen] = useState(false);
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
const groupOf = (kind: string) => (kind.startsWith("gitlab") ? "gitlab" : kind.startsWith("jira") ? "jira" : kind);

/** How much of each kind of context there is: small icons with numbers (5 Teams, 4 Mail, 3 Jira …). */
function ContextCounts({ items }: { items: Item[] }) {
  const t = useT();
  const counts = new Map<string, number>();
  for (const it of items) {
    const g = groupOf(itemKind(it).kind);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const shown = CONTEXT_GROUPS.filter((g) => counts.get(g.group));
  if (!shown.length) return null;
  return (
    <span className="ml-1.5 flex items-center gap-2 font-normal text-zinc-500 dark:text-zinc-400">
      {shown.map((g) => (
        <span key={g.group} className="flex items-center gap-0.5 tabular-nums" title={`${counts.get(g.group)} ${g.label(t)}`}>
          {g.icon}
          {counts.get(g.group)}
        </span>
      ))}
    </span>
  );
}

const itemKind = (it: Item) => ("n" in it ? { kind: it.n.by ? "report" : "note", at: it.n.at } : sourceKind(it.s));

/** A source's kind (Teams, Jira comment, mail, GitLab comment, MR, branch) and when it was written. */
function sourceKind(s: TodoSource): { kind: string; at: string } {
  // A chat's message counts as WhatsApp (Signal), not as mail (the mail sync reads them all).
  const kind = s.source === "gitlab" ? `gitlab-${s.gitlab.kind}` : s.source === "mail" && s.mail.folder === "WhatsApp" ? "whatsapp" : s.source === "mail" && s.mail.folder === "Signal" ? "signal" : s.source;
  return { kind, at: entityWhoWhen(s).at ?? "" };
}
