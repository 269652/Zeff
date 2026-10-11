"use client";

import { setTodoStatusAction } from "@/plugins/todos/server-actions";
import { todoKindLabels, type TodoSource, type TodoView } from "@/lib/boards/shared";
import { ChevronIcon } from "./icons";
import { TodoSources } from "./boards/TodoSources";
import { ResolveToggle } from "./ResolveToggle";
import { formatDate, formatTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

const day = (iso: string) => formatDate(iso, { weekday: false });
const full = (iso: string) => `${formatDate(iso, { year: true })}, ${formatTime(iso)}`;

/** Where a todo is shown: the Todos page (its Done tab once it's closed) — brought into view there. */
export const todoHref = (t: Pick<TodoView, "id" | "status">) => (t.status === "open" ? `/todos#todo-${t.id}` : `/todos?todos=done#todo-${t.id}`);

const STATUS = (t: T) => ({ open: t("open"), done: t("done"), dismissed: t("dismissed") });

/** Green once it's done, blue while it's open. */
const TONE = {
  done: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
    hover: "hover:bg-emerald-100 dark:hover:bg-emerald-950",
    accent: "text-emerald-600 dark:text-emerald-400",
    meta: "text-emerald-800/80 dark:text-emerald-300/80",
    words: "text-emerald-900/70 dark:text-emerald-100/70",
  },
  open: {
    box: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
    hover: "hover:bg-sky-100 dark:hover:bg-sky-950",
    accent: "text-sky-600 dark:text-sky-400",
    meta: "text-sky-800/80 dark:text-sky-300/80",
    words: "text-sky-900/70 dark:text-sky-100/70",
  },
};

/**
 * A link to a board todo, shown as the todo: its reference, ticket, what kind and whether it's
 * done — and what it asks. With `onToggle` a click unfolds it (the chevron); ↗ shows it on the
 * Todos page.
 */
export function TodoBadge({ t: todo, className = "", expanded = false, onToggle }: { t: TodoView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const closed = todo.status !== "open";
  const tone = TONE[closed ? "done" : "open"];
  const what = (
    <>
      {onToggle && <ChevronIcon open={expanded} className={`size-3.5 shrink-0 ${tone.accent}`} />}
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={`size-4 shrink-0 ${tone.accent}`} aria-hidden>
        <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
        {closed && <path d="m7 10.25 2 2 4-4.5" />}
      </svg>
      <span className="shrink-0 font-mono font-medium">{todo.ref}</span>
      {/* Ticket, kind and state — on a phone it gives way too (ellipsis). */}
      <span className={`shrink-0 max-sm:min-w-0 max-sm:shrink max-sm:truncate ${tone.meta}`}>
        {todo.ticket} · {todoKindLabels(t)[todo.kind]} · {closed ? `${STATUS(t)[todo.status]} ${day(todo.doneAt ?? todo.updatedAt)}` : STATUS(t).open}
      </span>
      <span className={`min-w-0 truncate ${tone.words}`}>{todo.text}</span>
    </>
  );
  const inner = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";
  return (
    <div className={`flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs ${tone.box} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${inner} cursor-pointer transition ${tone.hover}`} onClick={onToggle} aria-expanded={expanded} title={expanded ? t("Fold") : t("Show the whole todo")}>
          {what}
        </button>
      ) : (
        <span className={inner}>{what}</span>
      )}
      <a
        href={todoHref(todo)}
        target="_blank"
        rel="noreferrer"
        className={`flex shrink-0 items-center px-2 transition ${tone.accent} ${tone.hover}`}
        title={t("Show {ref} on the Todos page", { ref: todo.ref })}
        aria-label={t("Show {ref} on the Todos page", { ref: todo.ref })}
      >
        ↗
      </a>
    </div>
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
              onChange={(next) => setTodoStatusAction(todo.id, next ? "done" : "open")}
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
