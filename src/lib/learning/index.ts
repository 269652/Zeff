import { t } from "@/lib/i18n/server";
import { getPref, setPref } from "@/lib/prefs";
import { backfillFeedback } from "./backfill";
import { STEPS } from "./ledger";
import { qualityReport, type QualityReport } from "./quality";
import { learnedRules, proposeRules, type LearnedRule } from "./rules";
import { localDay } from "@/lib/dates";

/**
 * The learning loop as the pages, the review queue, the MCP tool and the API read it (server only): the past backfilled
 * (once a day at most — bounded and idempotent anyway), the rules repetition suggests brought up to date, the report.
 */

export { recordFeedback, STEPS, type Feedback, type Verdict } from "./ledger";

/** Each step's name, in the account's language. */
export function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    [STEPS.booking]: t("Booking suggestions"),
    [STEPS.mailReview]: t("Mail & chat review"),
    [STEPS.noteReview]: t("Note review"),
    [STEPS.documentReview]: t("Document review"),
    [STEPS.lage]: t("Briefing"),
    [STEPS.workers]: t("Workers (follow-up steps)"),
    [STEPS.autoActions]: t("Auto actions"),
    [STEPS.peopleIdentity]: t("People: same person?"),
    [STEPS.peopleClaim]: t("People: what the AI read"),
    [STEPS.peopleLink]: t("People: who is connected to what"),
    [STEPS.peopleDate]: t("People: dates found"),
    [STEPS.knowledgeRelation]: t("Knowledge relations"),
    [STEPS.wsAiFilter]: t("Workspace: AI filter"),
    [STEPS.wsAiField]: t("Workspace: AI fields"),
    [STEPS.todoDone]: t("Done? (suggested by workers and reviews)"),
    [STEPS.openLoops]: t("Open loops"),
    [STEPS.entities]: t("Organisations, projects and places"),
    [STEPS.shadowCalendar]: t("Shadow calendars"),
    [STEPS.dayPlan]: t("Day plan"),
  };
  return labels[step] ?? step;
}

/** The past decisions into the ledger, at most once a day (or now, `force`). How many were new. */
export function ensureBackfilled(force = false, now = Date.now()): number {
  const day = localDay(new Date(now));
  if (!force && getPref<string>("learning:backfilled", "") === day) return 0;
  const n = Object.values(backfillFeedback(now)).reduce((a, b) => a + b, 0);
  setPref("learning:backfilled", day);
  return n;
}

export type AiQualityView = QualityReport & { labels: Record<string, string>; proposed: LearnedRule[]; confirmed: LearnedRule[] };

/** Everything the quality page shows — one step only, `step`. */
export function aiQualityView(opts: { step?: string } = {}): AiQualityView {
  ensureBackfilled();
  const proposed = proposeRules();
  const report = qualityReport(Date.now(), opts);
  const labels = Object.fromEntries([...report.steps.map((s) => s.step), ...report.patterns.map((p) => p.step), ...proposed.map((r) => r.step)].map((s) => [s, stepLabel(s)]));
  return { ...report, labels, proposed, confirmed: learnedRules({ status: "confirmed" }) };
}

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

/** The report as text (the MCP tool): per step its rates, volume and trend; the patterns; the rules. */
export function aiQualityText(v: AiQualityView): string {
  const lines = [`# AI quality (from the user's decisions, as of ${v.at.slice(0, 16).replace("T", " ")})`, "", "| Step | 7 days | 30 days | 90 days | Trend | Decisions (90 d) |", "|---|---:|---:|---:|---:|---:|"];
  for (const s of v.steps) {
    const [w7, w30, w90] = s.windows;
    const trend = s.trend === null ? "–" : `${s.trend >= 0 ? "+" : ""}${Math.round(s.trend * 100)} pp`;
    lines.push(`| ${s.step} (${v.labels[s.step] ?? s.step}) | ${pct(w7.rate)} | ${pct(w30.rate)} | ${pct(w90.rate)} | ${trend} | ${w90.total} (✓${w90.accepted} ✗${w90.rejected} ✎${w90.edited} ·${w90.ignored}) |`);
  }
  if (!v.steps.length) lines.push("| (no decisions yet) | | | | | |");
  lines.push("", "Rate = accepted ÷ (accepted + rejected + edited); – below 3 decisions. Trend: the last 30 days against the 30 before.");
  if (v.patterns.length) {
    lines.push("", "## Most rejected patterns (90 days)");
    for (const p of v.patterns) lines.push(`- ${p.step}: ${[p.sender, p.kind].filter(Boolean).join(" · ")} — rejected ${p.rejected}×, accepted ${p.accepted}× (e.g. ${p.examples.slice(0, 2).map((e) => `„${e.text}“`).join(", ")})`);
  }
  if (v.proposed.length || v.confirmed.length) {
    lines.push("", "## Learned rules");
    for (const r of [...v.proposed, ...v.confirmed]) lines.push(`- [${r.status}] ${r.step}: from ${r.sender}, like „${r.kind}“ (${r.evidence.length} rejected)`);
  }
  return lines.join("\n");
}
