"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { Brief, BriefSummary } from "./shared";

/** The know plugin's server actions: a brief (of a meeting, a row, refs) with its kept summary; the AI's summary made on request; your verdict; the switch. */

export type KnowQuery = { event?: number; occurrence?: string; row?: number; refs?: string[] };
export type KnowAnswer = { ok: true; key: string; brief: Brief; summary: BriefSummary | null; canSummarize: boolean; auto: boolean } | { ok: false; error: string; /** The plugin is off. */ off?: boolean };

const off = () => (isInstalled("know") ? null : t("The “What you should know” plugin is not installed (Menu → Plugins)."));

const clean = (q: KnowQuery): KnowQuery => ({
  event: Number(q.event) > 0 ? Math.floor(Number(q.event)) : undefined,
  occurrence: typeof q.occurrence === "string" && /^\d{4}-\d{2}-\d{2}/.test(q.occurrence) ? q.occurrence.slice(0, 10) : undefined,
  row: Number(q.row) > 0 ? Math.floor(Number(q.row)) : undefined,
  refs: Array.isArray(q.refs) ? q.refs.map((r) => String(r).slice(0, 200)).slice(0, 20) : undefined,
});

async function answer(q: KnowQuery, make: boolean, force = false): Promise<KnowAnswer> {
  const no = off();
  if (no) return { ok: false, error: no, off: true };
  const { briefOfKey, cachedSummary, summarizeBrief, autoSummary } = await import("./summary");
  const got = await briefOfKey(clean(q));
  if (!got) return { ok: false, error: t("Nothing to say about it.") };
  const canSummarize = isInstalled("llm");
  const summary = make && canSummarize ? await summarizeBrief(got.key, got.brief, { force }) : cachedSummary(got.key, got.brief.hash);
  return { ok: true, key: got.key, brief: got.brief, summary, canSummarize, auto: autoSummary() };
}

/** The brief, put together now (no AI), with the summary kept for it (`current` false: made before something changed). */
export async function knowBriefAction(q: KnowQuery): Promise<KnowAnswer> {
  try {
    return await answer(q, false);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The AI's summary of the brief — made only when none is kept for it as it is now (`again`: anyway). */
export async function knowSummarizeAction(q: KnowQuery, again = false): Promise<KnowAnswer> {
  try {
    return await answer(q, true, !!again);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Your verdict on a summary: helpful or not (the learning ledger). */
export async function knowRateAction(key: string, helpful: boolean): Promise<{ ok: boolean }> {
  try {
    if (off() || !key) return { ok: false };
    (await import("./summary")).rateSummary(String(key).slice(0, 200), helpful ? "accepted" : "rejected");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Whether the summaries are made before your meetings by themselves (with the briefing). */
export async function knowAutoAction(on: boolean): Promise<{ ok: boolean }> {
  try {
    if (off()) return { ok: false };
    (await import("./summary")).setAutoSummary(!!on);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
