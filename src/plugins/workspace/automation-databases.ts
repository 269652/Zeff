import { createHash } from "node:crypto";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { Row } from "./model";
import { getDatabase, getPage, updatePage, updateSchema } from "./store";
import { getRoutine, listRoutines, routineRuns, updateRoutine, type Routine, type Trigger } from "./routines";
import type { WorkspaceSource } from "./source-point";

/**
 * The automations (routines: automations and agents) as rows of the Workspace - one row each with what starts it, whether it is on,
 * when it ran last and runs next - and every run as a row of its own (status, how long, what each step did): the visible list of what
 * ran. A routine stays a page with its configuration; the rows are a view of it, and the box "On" is two-way: ticking it off in the
 * row switches the routine off. Server only.
 */

const AUTOMATIONS = "workspace.automationsDb";
const RUNS = "workspace.automationRunsDb";
const R_REF = /^routine:(\d+)$/;
const F = { kind: "autokind", on: "autoon", when: "autowhen", last: "autolast", next: "autonext", status: "autostatus", runs: "autoruns", routine: "runroutine", runStatus: "runstatus", started: "runstarted", ended: "runended", secs: "runsecs", trigger: "runtrigger", failed: "runfailed", error: "runerror" };

const stamp = (r: Routine) => createHash("sha1").update(JSON.stringify([r.enabled, r.triggers, r.steps?.length])).digest("hex").slice(0, 12);

function triggerText(tr: Trigger, dbName: (id: number) => string): string {
  if (tr.kind === "manual") return t("by hand");
  if (tr.kind === "called") return t("called by another");
  if (tr.kind === "schedule") return tr.everyMinutes ? t("every {n} min", { n: tr.everyMinutes }) : `${tr.at ?? ""}${tr.days?.length ? ` (${tr.days.map((d) => ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d]).join(" ")})` : ""}`;
  return `${tr.event}${tr.db ? ` · ${dbName(tr.db)}` : ""}`;
}

const dbName = (id: number) => getDatabase(id)?.page.title || `#${id}`;

export function routineRecords() {
  return listRoutines().map((r) => {
    const last = routineRuns(r.pageId, 1)[0];
    return {
      ref: `routine:${r.pageId}`,
      title: r.title || t("Untitled"),
      fields: {} as Record<string, string>,
      url: `/workspace/${r.pageId}`,
      updatedAt: stamp(r),
      typed: [
        { id: F.kind, name: "Kind", type: "text" as const, value: r.kind === "agent" ? t("Agent") : t("Automation") },
        { id: F.on, name: "On", type: "checkbox" as const, value: r.enabled || null },
        { id: F.when, name: "Starts", type: "text" as const, value: r.triggers.map((x) => triggerText(x, dbName)).join(", ") },
        { id: F.last, name: "Last run", type: "date" as const, value: r.lastRunAt?.slice(0, 16) ?? null },
        { id: F.next, name: "Next run", type: "date" as const, value: r.nextRunAt?.slice(0, 16) ?? null },
        { id: F.status, name: "Last result", type: "text" as const, value: last?.status ?? "" },
      ],
    };
  });
}

export function runRecords() {
  return listRoutines().flatMap((r) =>
    routineRuns(r.pageId, 30).map((run) => {
      const secs = run.endedAt ? Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)) : null;
      const failed = run.log.filter((l) => l.status === "failed").length;
      return {
        ref: `routine-run:${run.id}`,
        title: `${r.title || t("Untitled")} · ${triggerText(run.trigger, dbName)}`,
        fields: {} as Record<string, string>,
        url: `/workspace/${r.pageId}`,
        text: run.log.map((l) => `- ${l.status === "ok" ? "✓" : l.status === "failed" ? "✗" : "·"} ${l.step}${l.note ? `: ${l.note}` : ""}`).join("\n"),
        updatedAt: `${run.status}:${run.endedAt ?? ""}`,
        typed: [
          { id: F.routine, name: "Automation", type: "text" as const, value: r.title || t("Untitled") },
          { id: F.runStatus, name: "Result", type: "text" as const, value: run.status },
          { id: F.started, name: "Started", type: "date" as const, value: run.startedAt.slice(0, 16) },
          { id: F.ended, name: "Ended", type: "date" as const, value: run.endedAt?.slice(0, 16) ?? null },
          { id: F.secs, name: "Seconds", type: "number" as const, value: secs },
          { id: F.trigger, name: "Started by", type: "text" as const, value: triggerText(run.trigger, dbName) },
          { id: F.failed, name: "Failed steps", type: "number" as const, value: failed },
          { id: F.error, name: "Error", type: "text" as const, value: run.error ?? "" },
        ],
      };
    }),
  );
}

/** The box "On" ticked off (or on) in a row switches the routine. */
export function pullRoutines(_dbId: number, rows: Row[]): void {
  for (const row of rows) {
    const m = R_REF.exec(String(row.cells.srcref ?? ""));
    const r = m ? getRoutine(Number(m[1])) : null;
    if (!m || !r || String(row.cells.srcedited ?? "") !== stamp(r)) continue;
    const on = row.cells[F.on] === true;
    if (on !== r.enabled) updateRoutine(r.pageId, { enabled: on });
  }
}

export const ROUTINES_SOURCE: WorkspaceSource = {
  id: "routines",
  get label() {
    return t("Automations");
  },
  icon: "⚙️",
  noNewRows: true,
  get hint() {
    return t("Your automations and agents: what starts them, whether they are on, when they ran and run next. The box “On” switches one.");
  },
  count: () => listRoutines().length,
  read: routineRecords,
  pull: pullRoutines,
};

export const RUNS_SOURCE: WorkspaceSource = {
  id: "routine-runs",
  get label() {
    return t("Automation runs");
  },
  icon: "🧾",
  noNewRows: true,
  get hint() {
    return t("Every run of an automation or agent — result, how long, what each step did.");
  },
  count: () => runRecords().length,
  read: runRecords,
};

/** The databases "Automations" and "Automation runs" (made once; a gone one is not made again), and the ones that exist read again when they are stale. */
export async function ensureAutomationDatabases(): Promise<void> {
  if (!isInstalled("workspace")) return;
  const { createExtSourceDatabase } = await import("./derived");
  const made: number[] = [];
  for (const [pref, source, title, sort] of [[AUTOMATIONS, "routines", t("Automations"), null], [RUNS, "routine-runs", t("Automation runs"), "runstarted"]] as const) {
    const id = getPref<number | null>(pref, null);
    if (id && getDatabase(id) && !getDatabase(id)!.page.archivedAt) {
      const ran = Date.parse(getDatabase(id)!.schema.pipeline?.ranAt ?? "");
      if (!ran || Date.now() - ran > 2 * 60000) made.push(id);
      continue;
    }
    if (id !== null) continue;
    const dbId = await createExtSourceDatabase(source, title);
    setPref(pref, dbId);
    updatePage(dbId, { fullWidth: true });
    const cur = getDatabase(dbId)!.schema;
    updateSchema(dbId, { ...cur, pipeline: cur.pipeline ? { ...cur.pipeline, everyMinutes: 10 } : cur.pipeline, views: cur.views.map((v) => (v.type === "table" && sort ? { ...v, sorts: [{ prop: sort, dir: "desc" as const }] } : v)) });
    made.push(dbId);
  }
  const { startPipeline } = await import("./pipeline");
  for (const id of made) void startPipeline(id, { ai: false }).done.catch(() => undefined);
}

/** The runs and the automations read again - a run began or ended (in the background). */
export function refreshAutomationDatabases(): void {
  for (const pref of [AUTOMATIONS, RUNS]) {
    const id = getPref<number | null>(pref, null);
    if (id && getPage(id) && !getPage(id)!.archivedAt) void import("./pipeline").then((p) => p.startPipeline(id, { ai: false })).catch(() => undefined);
  }
}
