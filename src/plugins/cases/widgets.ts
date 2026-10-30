import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { caseHref } from "./database";
import { caseTitle, type Case } from "./shared";
import { openOf } from "./bank";
import { listCases } from "./store";
import { localDay } from "@/lib/dates";

/**
 * The widgets of Cases: the money of the open cases as figures, and the payments and deadlines coming up — the Finances
 * overview is made of them. Server only.
 */

const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR" });
const today = () => localDay();
const inDays = (day: string) => Math.round((Date.parse(day) - Date.parse(today())) / 864e5);
const whenText = (day: string) => {
  const n = inDays(day);
  return n < 0 ? t("{n} d overdue", { n: -n }) : n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} d", { n });
};

/** The cases still running (not closed, not done by what the AI read). */
const running = (): Case[] => listCases().filter((c) => c.status === "open" && !c.compiled?.done);

export const CASES_WIDGETS: WorkspaceWidget[] = [
  {
    id: "cases.figures",
    get label() {
      return t("Cases in figures");
    },
    icon: "💶",
    get description() {
      return t("What is open in all your cases, what is due in the next 30 days, how many are running and how many are overdue.");
    },
    size: "full",
    ttl: 60,
    data: () => {
      const all = running();
      const open = all.reduce((sum, c) => sum + (openOf(c) ?? 0), 0);
      const soon = all.filter((c) => c.compiled?.nextDue && inDays(c.compiled.nextDue) >= 0 && inDays(c.compiled.nextDue) <= 30);
      const dueSoon = soon.reduce((sum, c) => sum + (c.compiled?.installment ?? c.compiled?.open ?? 0), 0);
      const overdue = all.filter((c) => c.compiled?.nextDue && inDays(c.compiled.nextDue) < 0).length;
      return {
        kind: "stats",
        tiles: [
          { label: t("Open in all"), value: euro(open) },
          { label: t("Due in 30 days"), value: euro(dueSoon), detail: t("{n} payments", { n: soon.length }) },
          { label: t("Running cases"), value: String(all.length) },
          { label: t("Overdue"), value: String(overdue), tone: overdue ? ("bad" as const) : ("good" as const) },
        ],
      };
    },
  },
  {
    id: "cases.due",
    get label() {
      return t("Payments and deadlines");
    },
    icon: "📆",
    get description() {
      return t("What is due in your cases — the overdue first, then the next days — each leading to its case with the GiroCode.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "days", label: t("Days ahead"), kind: "number", default: 30, min: 1, max: 180 },
        { key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const days = Number(config.days ?? 30);
      const due = running()
        .filter((c) => c.compiled?.nextDue && inDays(c.compiled.nextDue) <= days)
        .sort((a, b) => a.compiled!.nextDue!.localeCompare(b.compiled!.nextDue!));
      const items = await Promise.all(
        due.slice(0, Number(config.limit ?? 8)).map(async (c) => ({
          id: String(c.id),
          icon: "💶",
          text: caseTitle(c),
          detail: [c.compiled!.nextWhat, c.label].filter(Boolean).join(" · "),
          meta: whenText(c.compiled!.nextDue!),
          tone: inDays(c.compiled!.nextDue!) < 0 ? ("bad" as const) : inDays(c.compiled!.nextDue!) <= 3 ? ("warn" as const) : undefined,
          href: await caseHref(c.id),
        })),
      );
      return { kind: "list", items, count: due.length || undefined, empty: t("Nothing due.") };
    },
  },
  {
    id: "cases.open",
    get label() {
      return t("Open cases");
    },
    icon: "📁",
    get description() {
      return t("Your running cases, the newest activity first — with what is still open.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 }];
    },
    ttl: 60,
    data: async (config) => {
      const all = running();
      const items = await Promise.all(
        all.slice(0, Number(config.limit ?? 8)).map(async (c) => ({
          id: String(c.id),
          icon: "📁",
          text: caseTitle(c),
          detail: [c.compiled?.party, c.label].filter(Boolean).join(" · "),
          meta: openOf(c) != null ? euro(openOf(c)!) : undefined,
          href: await caseHref(c.id),
        })),
      );
      return { kind: "list", items, count: all.length || undefined, empty: t("No case running.") };
    },
  },
];
