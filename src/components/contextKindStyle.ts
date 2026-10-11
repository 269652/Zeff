import type { ContextKind } from "@/lib/contexts-shared";

/** Each context source's colours: its badge, and its links' chips. */
export const CONTEXT_KIND_STYLE: Record<ContextKind, string> = {
  teams: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  jira: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  gitlab: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  email: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  note: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};
