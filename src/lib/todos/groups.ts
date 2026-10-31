import { daysUntil } from "./due-shared";

/**
 * Your open todos in groups by how urgent they are — flagged by you first, then by their due date (overdue, today, this week,
 * later, none), the ones you set aside last. Each group keeps the order the todos came in (the briefing's). Client-safe.
 */

export const TODO_GROUPS = ["important", "overdue", "today", "week", "later", "none", "deferred"] as const;
export type TodoGroup = (typeof TODO_GROUPS)[number];

type Groupable = { due: string | null; flaggedAt?: string | null; deferred?: boolean };

export function groupOf(t: Groupable): TodoGroup {
  if (t.deferred) return "deferred";
  if (t.flaggedAt) return "important";
  if (!t.due) return "none";
  const d = daysUntil(t.due);
  return d < 0 ? "overdue" : d === 0 ? "today" : d <= 7 ? "week" : "later";
}

export function groupTodos<T extends Groupable>(todos: T[]): { key: TodoGroup; items: T[] }[] {
  const by = new Map<TodoGroup, T[]>();
  for (const t of todos) {
    const g = groupOf(t);
    by.set(g, [...(by.get(g) ?? []), t]);
  }
  return TODO_GROUPS.filter((g) => by.has(g)).map((g) => ({ key: g, items: by.get(g)! }));
}
