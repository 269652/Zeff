import { t } from "@/lib/i18n/server";
import type { WidgetSetting, WorkspaceWidget } from "@/plugins/workspace/widget-point";
import type { Finding, Report } from "./engine";
import * as core from "./core";
import { seriesCatalog } from "@/lib/series/series";
import type { SeriesInfo } from "@/lib/series/series-point";

/**
 * The Correlations widget: a target picked (a journal's Energy or Mood, any field of a database with a date, or one of Zeff's own
 * series), the findings that hold over the last days — each its other series, the sentence with its numbers, the two groups' means
 * as a tiny chart, a click to explore the pair. Too few days or nothing reliable: said so, not filled with weak findings.
 */

export const exploreHref = core.exploreHref;
export const findingItem = (r: Report, f: Finding, days: number) => core.findingItem(r, f, days, t);

/** Your own databases' fields first (what you write down about your days), then Zeff's series. */
const targets = (): SeriesInfo[] => seriesCatalog().sort((a, b) => Number(b.id.startsWith("db:")) - Number(a.id.startsWith("db:")));

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
      const { seriesOf } = await import("./report");
      const { todayLocal } = await import("@/lib/series/days");
      return core.widgetData(await seriesOf(core.period({ days: Number(config.days) }, todayLocal())), config, todayLocal(), t);
    },
  },
];
