import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import { readLog } from "@/lib/work/log";
import type { WorkLogLine } from "@/lib/work/shared";
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
  provider: string | null;
  steps: Step[];
  runs: RoutineRun[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Why it cannot run (null: it can). */
  problem: string | null;
  /** The run going on (Run waits for it): its worker run, how the worker stands, what it did last (the newest last). */
  live: { runId: number; startedAt: string; workRunId: number | null; workStatus: string | null; activity: string[] } | null;
};

type Activity = (workRunId: number) => { status: string; lines: WorkLogLine[] } | null;

/** A worker's log line in one short line — what it did or said (not your prompt, not the tools' results). */
function lineText(l: WorkLogLine): string | null {
  const text = l.k === "tool" ? `${l.tool}: ${l.text}` : l.k === "say" || l.k === "note" || l.k === "ask" || l.k === "deny" ? l.text : null;
  if (!text) return null;
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

function realActivity(workRunId: number): ReturnType<Activity> {
  const w = getSqlite().prepare("select status from work_runs where id = ?").get(workRunId) as { status: string } | undefined;
  return w ? { status: w.status, lines: readLog(workRunId).lines } : null;
}

function liveRun(runs: RoutineRun[], activity: Activity): RoutineView["live"] {
  const run = runs.find((x) => x.status === "running");
  if (!run) return null;
  const a = run.workRunId ? activity(run.workRunId) : null;
  const activityLines = (a?.lines ?? []).map(lineText).filter((x): x is string => !!x).slice(-5);
  return { runId: run.id, startedAt: run.startedAt, workRunId: run.workRunId, workStatus: a?.status ?? null, activity: activityLines };
}

export function routineView(pageId: number, deps: { workRun?: Parameters<typeof syncAgentRuns>[0]; activity?: Activity } = {}): RoutineView | null {
  const r = getRoutine(pageId);
  if (!r) return null;
  syncAgentRuns(deps.workRun);
  const schedules = r.triggers.filter((x) => x.kind === "schedule");
  const runs = routineRuns(pageId, 10);
  const planned =r.nextRunAt ?? (schedules.length ? new Date(Math.min(...schedules.map((s) => nextRunAfter(s, new Date())?.getTime() ?? Infinity))).toISOString() : null);
  return {
    pageId,
    title: getPage(pageId)?.title ?? "",
    kind: r.kind,
    enabled: r.enabled,
    triggers: r.triggers,
    permissions: r.permissions,
    provider: r.provider ?? null,
    steps: r.steps,
    runs,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.enabled ? planned : null,
    problem: r.kind === "agent" && !isInstalled("work") ? t("The Code plugin is needed — agents run as workers (Menu → Plugins).") : null,
    live: liveRun(runs, deps.activity ?? realActivity),
  };
}
