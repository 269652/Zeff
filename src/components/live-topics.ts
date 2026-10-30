/** The pages that show runs and todos follow the changes they show — and every page follows what a sync brought. Client-safe. */
const LIVE: [RegExp, string[]][] = [
  [/^\/$/, ["work", "todos", "attention"]],
  [/^\/work/, ["work", "todos", "attention"]],
  [/^\/todos/, ["work", "todos", "attention"]],
  [/^\/tickets/, ["work", "todos", "attention"]],
  [/^\/t\//, ["work", "todos", "attention"]],
  [/^\/heute/, ["work", "todos", "attention"]],
];

/** The change topics a page refreshes on: its own, and "sync" (mails, chats, tickets, news … — whatever a sync step brought). */
export const topicsFor = (path: string): string[] => [...(LIVE.find(([r]) => r.test(path))?.[1] ?? []), "sync"];
