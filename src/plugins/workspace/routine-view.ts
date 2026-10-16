import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { syncAgentRuns } from "./routine-agent";
import { nextRunAfter } from "./routine-triggers";
import { getRoutine, routineRuns, type Permissions, type RoutineKind, type RoutineRun, type Step, type Trigger } from "./routines";
import { getPage } from "./store";

/** What a routine page's controls show: the routine, its newest runs (agents' runs brought up to date), when it runs next, what is missing. */
export type RoutineView = {
  pageId: number;
  title: string;
  kind: RoutineKind;
  enabled: boolean;
  triggers: Trigger[];
  permissions: Permissions;
  steps: Step[];
  runs: RoutineRun[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Why it cannot run (null: it can). */
  problem: string | null;
};

export function routineView(pageId: number, deps: { workRun?: Parameters<typeof syncAgentRuns>[0] } = {}): RoutineView | null {
  const r = getRoutine(pageId);
  if (!r) return null;
  syncAgentRuns(deps.workRun);
  const schedules = r.triggers.filter((x) => x.kind === "schedule");
  const planned = r.nextRunAt ?? (schedules.length ? new Date(Math.min(...schedules.map((s) => nextRunAfter(s, new Date())?.getTime() ?? Infinity))).toISOString() : null);
  return {
    pageId,
    title: getPage(pageId)?.title ?? "",
    kind: r.kind,
    enabled: r.enabled,
    triggers: r.triggers,
    permissions: r.permissions,
    steps: r.steps,
    runs: routineRuns(pageId, 10),
    lastRunAt: r.lastRunAt,
    nextRunAt: r.enabled ? planned : null,
    problem: r.kind === "agent" && !isInstalled("work") ? t("The Code plugin is needed — agents run as workers (Menu → Plugins).") : null,
  };
}
