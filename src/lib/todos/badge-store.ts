/** The Todos tab's badge as set for this account (lib/todos/badge.ts), and the numbers it counts. Server only. */
import { localDay } from "@/lib/dates";
import { getPref, setPref } from "@/lib/prefs";
import { lastGoodRun, latestRun } from "@/lib/runs/store";
import { boardTodos } from "@/lib/todos/store";
import { isInstalled } from "@/plugins/state";
import { DEFAULT_BADGE, parseBadge, type BadgeConfig } from "./badge";

const PREF = "todos.badge";

export function getTodoBadge(): BadgeConfig {
  try {
    return parseBadge(getPref<unknown>(PREF, null));
  } catch {
    return DEFAULT_BADGE;
  }
}

export function setTodoBadge(config: unknown): BadgeConfig {
  const clean = parseBadge(config);
  setPref(PREF, clean);
  return clean;
}

/** Your open todos (not those waiting on someone else), how many are past their day and how many are due today. */
export function openTodoCounts(): { open: number; late: number; today: number } | undefined {
  if (!isInstalled("todos")) return undefined;
  try {
    const today = localDay();
    // As the Todos tab counts "Your todos": on the briefing's tickets (or on none), not the workers' nor merged ones.
    const last = latestRun();
    const run = last?.status === "ok" ? last : lastGoodRun();
    const mine = boardTodos([...(run?.tickets.map((x) => x.key) ?? []), ""]).filter((x) => x.status === "open" && x.owner === "me");
    return { open: mine.length, late: mine.filter((x) => !!x.due && x.due < today).length, today: mine.filter((x) => x.due === today).length };
  } catch {
    return undefined;
  }
}
