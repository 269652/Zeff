import type { T } from "@/lib/i18n/shared";

/** What happened to a todo — one line of the Aktivität tab. */
export type TodoEventKind = "created" | "done" | "dismissed" | "reopened" | "merged";

export type TodoEventView = {
  id: number;
  todoId: number;
  event: TodoEventKind;
  ticket: string;
  /** The todo's text then. */
  text: string;
  /** Why (a closing note), or where a new one (or a merged duplicate) came from. */
  note: string | null;
  /** Who did it, in words, and where to look. */
  by: { label: string; href?: string; title?: string };
  /** Who did it was you (a click): not news. */
  mine: boolean;
  /** Is the todo open now. */
  openNow: boolean;
  at: string;
};

export const TODO_EVENT_LABELS: Record<TodoEventKind, { icon: string; label: string; tone: string }> = {
  created: { icon: "＋", label: "new", tone: "text-sky-600 dark:text-sky-400" },
  done: { icon: "✓", label: "done", tone: "text-emerald-600 dark:text-emerald-400" },
  dismissed: { icon: "✕", label: "dismissed", tone: "text-zinc-500" },
  reopened: { icon: "↺", label: "reopened", tone: "text-amber-600 dark:text-amber-400" },
  merged: { icon: "⇄", label: "merged", tone: "text-violet-600 dark:text-violet-400" },
};

/** The same, its labels in the account's language. */
export const todoEventLabels = (t: T): Record<TodoEventKind, { icon: string; label: string; tone: string }> => ({
  created: { ...TODO_EVENT_LABELS.created, label: t("new") },
  done: { ...TODO_EVENT_LABELS.done, label: t("done") },
  dismissed: { ...TODO_EVENT_LABELS.dismissed, label: t("dismissed") },
  reopened: { ...TODO_EVENT_LABELS.reopened, label: t("reopened") },
  merged: { ...TODO_EVENT_LABELS.merged, label: t("merged") },
});

/** Where the newest seen event's id is kept (this browser). */
export const ACTIVITY_SEEN_KEY = "zeff-activity-seen";
/** Fired when it changes (in this tab — other tabs get "storage"). */
export const ACTIVITY_SEEN_EVENT = "zeff-activity-seen";
