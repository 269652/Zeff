"use server";

import { t } from "@/lib/i18n/server";
import * as store from "../store";
import { run } from "./shared";

// ---------------------------------------------------------------------------
// Routines: automations and agents (the controls block of their pages)
// ---------------------------------------------------------------------------

/** What the controls of a routine page show. Null: the page is no routine (yet). */
export async function routineViewAction(pageId: number) {
  return run(async () => ({ view: (await import("../routine-view")).routineView(Number(pageId)) }));
}

/** Older runs of a routine (the log tab): a page of them after the run given, and whether there are more. */
export async function routineRunsAction(pageId: number, beforeId?: number) {
  return run(async () => {
    const { routineRuns } = await import("../routines");
    const rows = routineRuns(Number(pageId), 21, beforeId ? Number(beforeId) : undefined);
    return { runs: rows.slice(0, 20), more: rows.length > 20 };
  });
}

/** The reports of an agent (the Reports tab): one per session, drafts waiting for your OK and the final ones. */
export async function routineReportsAction(pageId: number) {
  return run(async () => ({ reports: (await import("../routine-reports")).listReports(Number(pageId)) }));
}

/** Your OK on a report: its todo is closed, the report is final. */
export async function approveReportAction(reportId: number) {
  return run(async () => {
    const m = await import("../routine-reports");
    m.approveReport(Number(reportId));
    return { ok: true as const };
  });
}

/** A page made a routine (an agent or an automation) — off, started by hand. */
export async function makeRoutineAction(pageId: number, kind: string) {
  return run(async () => {
    (await import("../routine-make")).makeRoutinePage(Number(pageId), kind === "automation" ? "automation" : "agent");
    return { view: (await import("../routine-view")).routineView(Number(pageId)) };
  });
}

/** A routine's settings changed: on or off, when it runs, what it may touch, its steps (what is given replaces what was). */
export async function saveRoutineAction(pageId: number, patch: { enabled?: boolean; triggers?: unknown; permissions?: unknown; steps?: unknown; provider?: string }) {
  return run(async () => {
    const r = await import("../routines");
    r.updateRoutine(Number(pageId), {
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(patch.triggers !== undefined ? { triggers: patch.triggers as never } : {}),
      ...(patch.permissions !== undefined ? { permissions: patch.permissions as never } : {}),
      ...(patch.steps !== undefined ? { steps: patch.steps as never } : {}),
      ...("provider" in patch ? { provider: patch.provider as never } : {}),
    });
    return { view: (await import("../routine-view")).routineView(Number(pageId)) };
  });
}

/** Run a routine now, by hand. An automation runs through (its log is the answer); an agent starts a worker and goes on. */
export async function runRoutineAction(pageId: number) {
  return run(async () => {
    const { runRoutine } = await import("../routine-run");
    const res = await runRoutine(Number(pageId), { kind: "manual" });
    return { status: res.status, error: res.error ?? null, view: (await import("../routine-view")).routineView(Number(pageId)) };
  });
}

/** What the steps' pickers offer: the databases (with their fields) and the other routines. */
export async function routineChoicesAction() {
  return run(async () => {
    const { listRoutines } = await import("../routines");
    return {
      databases: store.tree().filter((x) => x.kind === "database" && !x.system).map((x) => ({ id: x.id, title: x.title || t("Untitled"), fields: (store.getDatabase(x.id)?.schema.properties ?? []).filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id)).map((p) => p.name) })),
      routines: listRoutines().map((r) => ({ id: r.pageId, title: r.title || t("Untitled"), kind: r.kind })),
      methods: (await import("../routine-methods")).automaticMethods().map((m) => ({ name: m.name, label: m.label, fields: m.fields })),
    };
  });
}
