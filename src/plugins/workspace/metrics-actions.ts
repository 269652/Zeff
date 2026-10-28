"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { evalFormula } from "./formula";
import { defineFormulaMetric, forgetMetricValues, formatMetric, getMetric, listMetrics, metricHistory, metricValue, removeMetric, setMetricMeta, type Metric, type MetricAlert, type MetricGoal } from "./metrics";

/** The Kennzahlen page's actions (Workspace → Kennzahlen). */

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const run = async <T extends object>(fn: () => T | Promise<T>): Promise<Res<T>> => {
  try {
    if (!isInstalled("workspace")) return { ok: false, error: "The Workspace is not installed." };
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
};

export type MetricView = Metric & { shown: string; history: { day: string; value: number }[] };

/** Every Kennzahl with its value as shown and its last 90 days. */
export async function metricsAction(): Promise<Res<{ metrics: MetricView[] }>> {
  return run(() => {
    forgetMetricValues();
    return { metrics: listMetrics().map((m) => ({ ...m, shown: formatMetric(m.value, m.unit), history: metricHistory(m.key, 90) })) };
  });
}

/** What a formula gives now (the editor's preview) — without keeping anything. */
export async function previewMetricFormulaAction(formula: string): Promise<Res<{ value: string }>> {
  return run(() => {
    const r = evalFormula(formula, { prop: () => null, metric: (n) => metricValue(n).value });
    if ("error" in r) throw new Error(r.error);
    return { value: r.value === null ? "–" : typeof r.value === "number" ? formatMetric(Math.round(r.value * 10000) / 10000, "") : String(r.value) };
  });
}

export async function defineMetricAction(v: { name: string; formula: string; unit?: string; what?: string }): Promise<Res<{ key: string }>> {
  return run(() => {
    const key = defineFormulaMetric({ label: String(v.name), formula: String(v.formula), unit: v.unit, what: v.what });
    revalidatePath("/workspace/metrics");
    return { key };
  });
}

export async function setMetricMetaAction(name: string, patch: { unit?: string; what?: string; goal?: MetricGoal | null; alert?: MetricAlert | null }): Promise<Res> {
  return run(() => {
    setMetricMeta(String(name), patch);
    revalidatePath("/workspace/metrics");
    return {};
  });
}

export async function removeMetricAction(name: string): Promise<Res> {
  return run(() => {
    if (!getMetric(name)) throw new Error("No such Kennzahl.");
    removeMetric(String(name));
    revalidatePath("/workspace/metrics");
    return {};
  });
}
