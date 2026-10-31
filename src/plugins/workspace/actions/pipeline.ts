"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import * as store from "../store";
import { run } from "./shared";

/**
 * A database's pipeline run now: its sources kept as its rows (at once); with `ai`, its AI steps then in the background —
 * the page stays usable (a page's actions wait for each other), the view reads the rows as the AI fills them.
 */
export async function runPipelineAction(dbId: number, ai = true) {
  return run(async () => {
    if (ai && !isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    return rowsThenAi(Number(dbId), !!ai);
  });
}

async function rowsThenAi(dbId: number, ai: boolean) {
  const p = await import("../pipeline");
  if (p.pipelineRunning(dbId)) return { records: 0, created: 0, updated: 0, archived: 0, background: true, already: true };
  const d = store.getDatabase(dbId);
  // Its rows need the AI (an AI filter): all of it in the background — the view follows as the AI judges.
  if (d && p.needsBackground(d.schema)) {
    p.startPipeline(dbId, { ai });
    return { records: store.rawRows(dbId).length, created: 0, updated: 0, archived: 0, background: true, already: false };
  }
  const r = await p.runPipeline(dbId, { ai: false });
  if (!r.ok) throw new Error(r.error ?? t("Failed."));
  const background = ai && p.startPipeline(dbId, { ai: true }).started;
  return { records: r.records, created: r.created, updated: r.updated, archived: r.archived, background, already: false };
}

/** An AI filter's rows judged all again (its verdicts dropped) — in the background. */
export async function rejudgeAction(dbId: number, stepId: string) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const p = await import("../pipeline");
    p.forgetVerdicts(String(stepId), Number(dbId));
    return { started: p.startPipeline(Number(dbId), { ai: true }).started };
  });
}

/** An AI filter tried on a sample (what it would keep) — nothing saved. */
export async function previewAiFilterAction(dbId: number, steps: unknown, stepId: string) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const { normalizePipeline } = await import("../model");
    const checked = normalizePipeline({ steps }).steps;
    return { rows: await (await import("../pipeline")).previewAiFilter(Number(dbId), checked, String(stepId), 15) };
  });
}

/** What a set step would change now (its matching rows) — nothing saved. */
export async function previewSetAction(dbId: number, steps: unknown, stepId: string) {
  return run(async () => {
    const { normalizePipeline } = await import("../model");
    const checked = normalizePipeline({ steps }).steps;
    return { rows: await (await import("../pipeline")).previewSet(Number(dbId), checked, String(stepId)) };
  });
}

/** What a join step would do now (which rows find their row) — nothing saved. */
export async function previewJoinAction(dbId: number, steps: unknown, stepId: string) {
  return run(async () => {
    const { normalizePipeline } = await import("../model");
    const checked = normalizePipeline({ steps }).steps;
    return { rows: await (await import("../pipeline")).previewJoin(Number(dbId), checked, String(stepId)) };
  });
}

/** A pipeline's last runs (what it did, what the AI did in it and cost). */
export async function pipelineRunsAction(dbId: number) {
  return run(async () => ({ runs: (await import("../pipeline")).pipelineRuns(Number(dbId), 12) }));
}

/** The syncs a pipeline's sources are read by (jira, keep): how often each runs by itself, and what can be picked. */
export async function sourceSyncsAction() {
  return run(async () => {
    const { findSyncInterval } = await import("@/plugins/sync-settings-modules");
    const out: Record<string, { minutes: number; choices: number[] }> = {};
    for (const key of ["jira", "keep", "mail"]) {
      const i = findSyncInterval(key);
      if (i) out[key] = { minutes: i.get(), choices: [...new Set([...i.choices, i.get()])].sort((a, b) => a - b) };
    }
    return { syncs: out };
  });
}

/** A database's pipeline refreshed now: the syncs of its sources run first (Jira, Google Keep), then the pipeline (with its AI steps when there's an AI). */
export async function refreshPipelineAction(dbId: number) {
  return run(async () => {
    const d = store.getDatabase(Number(dbId));
    if (!d) throw new Error(t("No such database."));
    const froms = new Set((d.schema.pipeline?.steps ?? []).filter((s) => s.kind === "source").map((s) => s.from));
    // A database it reads (a derived one's parent): that one's rows first (they're quick — its own AI goes in the background).
    for (const s of d.schema.pipeline?.steps ?? []) if (s.kind === "source" && s.from === "database" && s.dbId) await rowsThenAi(s.dbId, false).catch(() => null);
    // (In the background — what they bring comes into the pipeline when they're done; already syncing: that one.)
    const { isSyncKey, startSync } = await import("@/lib/sync/registry");
    const syncing: string[] = [];
    for (const key of ["jira", "keep"] as const) if (froms.has(key) && isSyncKey(key) && (await startSync(key)).ok) syncing.push(key === "jira" ? "Jira" : "Google Keep");
    return { ...(await rowsThenAi(Number(dbId), isInstalled("llm"))), syncing };
  });
}
