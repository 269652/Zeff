/** What happened to a todo — one line of the Aktivität tab. */
export type TodoEventKind = "created" | "done" | "dismissed" | "reopened";

export type TodoEventView = {
  id: number;
  todoId: number;
  event: TodoEventKind;
  ticket: string;
  /** The todo's text then. */
  text: string;
  /** Why (a closing note), or where a new one came from. */
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
  created: { icon: "＋", label: "neu", tone: "text-sky-600 dark:text-sky-400" },
  done: { icon: "✓", label: "erledigt", tone: "text-emerald-600 dark:text-emerald-400" },
  dismissed: { icon: "✕", label: "verworfen", tone: "text-zinc-500" },
  reopened: { icon: "↺", label: "wieder offen", tone: "text-amber-600 dark:text-amber-400" },
};

/** Where the newest seen event's id is kept (this browser). */
export const ACTIVITY_SEEN_KEY = "zeff-activity-seen";
/** Fired when it changes (in this tab — other tabs get "storage"). */
export const ACTIVITY_SEEN_EVENT = "zeff-activity-seen";
