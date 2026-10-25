"use client";

import { setTodoStatusConfirmed } from "@/components/boards/todo-status";
import { todoKindLabels, type TodoSource, type TodoView } from "@/lib/boards/shared";
import { SourceCard } from "./SourceCard";
import { TodoSources } from "./boards/TodoSources";
import { ResolveToggle } from "./ResolveToggle";
import { formatDate, formatDayTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

const day = (iso: string) => formatDate(iso, { weekday: false });
const full = (iso: string) => formatDayTime(iso, { year: true });

/** Where a todo is shown: the Todos page (its Done tab once it's closed) — brought into view there. */
export const todoHref = (t: Pick<TodoView, "id" | "status">) => (t.status === "open" ? `/todos#todo-${t.id}` : `/todos?todos=done#todo-${t.id}`);

const STATUS = (t: T) => ({ open: t("open"), done: t("done"), dismissed: t("dismissed") });

/**
 * A link to a board todo, as a small card: its text, ticket, kind and whether it's done. With
 * `onToggle` a click unfolds it (the chevron); ↗ shows it on the Todos page.
 */
export function TodoBadge({ t: todo, className = "", expanded = false, onToggle }: { t: TodoView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const closed = todo.status !== "open";
  return (
    <SourceCard
      tone="indigo"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
          {closed && <path d="m7 10.25 2 2 4-4.5" />}
        </svg>
      }
      kind={`${t("Todo")} ${todo.ref}`}
      state={{
        text: closed ? `${STATUS(t)[todo.status]} ${day(todo.doneAt ?? todo.updatedAt)}` : STATUS(t).open,
        className: closed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
      }}
      title={todo.text || todo.ref}
      sub={[todo.ticket, todoKindLabels(t)[todo.kind]].filter(Boolean).join(" · ")}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the whole todo")}
      href={todoHref(todo)}
      hrefTitle={t("Show {ref} on the Todos page", { ref: todo.ref })}
      className={className}
    />
  );
}


/**
 * A board todo in full, as a card: what it asks, why it was closed, what it came from (`from`:
 * badges with hover cards) — tick it done here too.
 */
export function TodoDetails({ t: todo, from = [] }: { t: TodoView; from?: TodoSource[] }) {
  const t = useT();
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
        <span>
          {t("Todo")} · {todoKindLabels(t)[todo.kind]}
          {todo.owner === "other" ? ` · ${t("waiting on others")}` : ""}
          {todo.status === "dismissed" ? ` · ${t("dismissed")}` : ""}
        </span>
        <span className="flex items-center gap-2">
          {todo.status !== "dismissed" && (
            <ResolveToggle
              done={todo.status === "done"}
              onChange={(next) => setTodoStatusConfirmed(todo.id, next ? "done" : "open")}
              hint={{ done: t("{ref} is done. Click: reopen.", { ref: todo.ref }), open: t("Mark {ref} as done", { ref: todo.ref }) }}
            />
          )}
          <a href={todoHref(todo)} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open in Boards")} ↗
          </a>
        </span>
      </div>
      <p className="leading-snug">{todo.text}</p>
      {todo.note && <p className="text-xs text-zinc-500">{todo.note}</p>}
      {/* Everything it has: what it came from, and the notes on it — yours and the runs' reports. */}
      {(from.length > 0 || todo.userNotes.length > 0) && <TodoSources list={from} notes={todo.userNotes} />}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {row(t("Todo"), todo.ref, true)}
        {row(t("Ticket"), todo.ticket, true)}
        {row(t("Source"), todo.source)}
        {row(t("Found"), full(todo.createdAt))}
        {todo.doneAt && row(todo.status === "dismissed" ? t("Dismissed") : t("Done"), full(todo.doneAt))}
      </dl>
    </div>
  );
}
