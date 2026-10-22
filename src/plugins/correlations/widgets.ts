import { t } from "@/lib/i18n/server";
import type { WidgetItem, WidgetSetting, WorkspaceWidget } from "@/plugins/workspace/widget-point";
import { num, type Finding, type Report } from "./engine";
import { seriesCatalog } from "./series";
import type { SeriesInfo } from "./series-point";

/**
 * The Correlations widget: a target picked (a journal's Energy or Mood, any field of a database with a date, or one of Zeff's own
 * series), the findings that hold over the last days — each its other series, the sentence with its numbers, the two groups' means
 * as a tiny chart, a click to explore the pair. Too few days or nothing reliable: said so, not filled with weak findings.
 */

/** The page that explores a pair (and, without `x`, the target's findings). */
export const exploreHref = (y: string, opts: { x?: string; lag?: 0 | 1; days?: number } = {}): string => {
  const q = new URLSearchParams({ y });
  if (opts.x) q.set("x", opts.x);
  if (opts.x) q.set("lag", String(opts.lag ?? 0));
  if (opts.days) q.set("days", String(opts.days));
  return `/correlations?${q.toString()}`;
};

/** Your own databases' fields first (what you write down about your days), then Zeff's series. */
const targets = (): SeriesInfo[] => seriesCatalog().sort((a, b) => Number(b.id.startsWith("db:")) - Number(a.id.startsWith("db:")));

/** The bars of a finding: the target's mean in its two groups ("> 3 h" and "≤ 3 h", "with" and "without"). */
function bars(f: Finding): WidgetItem["mini"] {
  const g = f.groups;
  if (!g) return undefined;
  const unit = f.other.unit ? ` ${f.other.unit}` : "";
  const [hi, lo] = g.threshold === null || g.threshold === 0 ? [t("with"), t("without")] : [`> ${num(g.threshold)}${unit}`, `≤ ${num(g.threshold)}${unit}`];
  const day = f.lag ? `${t("day before")}: ` : "";
  return { bars: [{ label: `${day}${hi}`, value: Math.round(g.high.mean * 100) / 100 }, { label: `${day}${lo}`, value: Math.round(g.low.mean * 100) / 100 }] };
}

export function findingItem(r: Report, f: Finding, days: number): WidgetItem {
  return {
    id: `${f.other.id}:${f.lag}`,
    icon: f.rho > 0 ? "↗" : "↘",
    text: f.other.label,
    detail: f.sentence,
    wrap: true,
    badge: `ρ ${num(f.rho, 2)}`,
    meta: f.lag ? t("day after") : undefined,
    mini: bars(f),
    href: exploreHref(r.target.id, { x: f.other.id, lag: f.lag, days }),
  };
}

export const CORRELATION_WIDGETS: WorkspaceWidget[] = [
  {
    id: "correlations.findings",
    get label() {
      return t("Correlations");
    },
    icon: "🔗",
    get description() {
      return t("What goes with a field of your days — a journal's energy or mood against meetings, booked hours, messages, spending and your other fields — only what holds, with n.");
    },
    get settings(): WidgetSetting[] {
      const all = targets();
      return [
        { key: "target", label: t("What to explain"), kind: "select", default: all[0]?.id ?? "", options: all.map((s) => ({ value: s.id, label: s.label })) },
        { key: "days", label: t("Days back"), kind: "number", default: 90, min: 14, max: 730 },
        { key: "limit", label: t("How many"), kind: "number", default: 4, min: 1, max: 10 },
      ];
    },
    size: "half",
    ttl: 600,
    data: async (config) => {
      const { correlationReport, period } = await import("./report");
      const days = Number(config.days);
      const target = String(config.target ?? "");
      if (!target) return { kind: "list", items: [], empty: t("Pick a field to explain in the widget's settings — a journal's energy, say.") };
      const res = await correlationReport({ field: target }, period({ days }), { limit: Number(config.limit) });
      if ("error" in res) return { kind: "error", message: res.error };
      const r = res.report;
      return {
        kind: "list",
        title: `${r.target.label} · ${t("{n} days", { n: r.days })} · ${t("{n} comparisons", { n: r.tested })}`,
        items: r.findings.map((f) => findingItem(r, f, days)),
        empty: r.insufficient ?? t("No link holds yet — nothing goes with it reliably over these days."),
        footer: { text: t("Explore any pair"), href: exploreHref(r.target.id, { days }) },
      };
    },
  },
];
