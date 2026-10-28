import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { MetricsBoard } from "@/plugins/workspace/ui/Metrics";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Metrics") };
}

/** Workspace → Kennzahlen: every named number with its value, history, goal and thresholds — and new ones from a formula. */
export default async function MetricsPage() {
  await connection();
  if (!isInstalled("workspace")) return null;
  const { metricsAction } = await import("@/plugins/workspace/metrics-actions");
  const r = await metricsAction();
  return <MetricsBoard initial={r.ok ? r.metrics : []} />;
}
