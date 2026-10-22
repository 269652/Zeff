import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { debtPlans, debtsDbId } from "./debts";
import { fixedCosts } from "./fixed";
import { monthlyIncome } from "./income";
import type { Direction } from "./own";

/**
 * The widgets of Finances: your debts (or what you are owed) in figures — open, the instalments a month, when you are free of
 * them, what is left of your income — and the payments coming up, each leading to its row in the debts database. Server only.
 */

const euro = (v: number, digits = 0) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (day: string) => Math.round((Date.parse(day.slice(0, 10)) - Date.parse(today())) / 864e5);
const whenText = (day: string) => {
  const n = inDays(day);
  return n < 0 ? t("{n} d overdue", { n: -n }) : n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} d", { n });
};
const monthYear = (iso: string) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const dirSetting = (): WidgetSetting => ({
  key: "dir",
  label: t("Whose"),
  kind: "select",
  default: "owe",
  options: [
    { value: "owe", label: t("What I owe") },
    { value: "owed", label: t("What I am owed") },
  ],
});
const dirOf = (v: unknown): Direction => (v === "owed" ? "owed" : "owe");
const href = () => {
  const db = debtsDbId();
  return db ? `/workspace/${db}` : undefined;
};

export const FINANCES_WIDGETS: WorkspaceWidget[] = [
  {
    id: "finances.figures",
    get label() {
      return t("Debts in figures");
    },
    icon: "💶",
    get description() {
      return t("What is open, the instalments a month, when you are debt-free and what is left of your income after the instalments and fixed costs — or the same for what you are owed.");
    },
    get settings() {
      return [dirSetting()];
    },
    size: "full",
    ttl: 60,
    data: (config) => {
      const dir = dirOf(config.dir);
      const { debts, summary } = debtPlans(today(), dir);
      const open = debts.reduce((s, d) => s + d.open, 0);
      const link = href();
      const tiles = [
        { label: dir === "owe" ? t("Open in all") : t("Owed to you in all"), value: euro(open), detail: t("{n} open", { n: debts.length }), href: link },
        { label: dir === "owe" ? t("Instalments a month") : t("Coming back a month"), value: euro(summary.monthlyRates), detail: t("running now"), href: link },
        {
          label: dir === "owe" ? t("Debt-free") : t("All back"),
          value: summary.debtFree ? monthYear(summary.debtFree) : "—",
          detail: summary.unplanned > 0 ? t("{amount} without a plan not in it", { amount: euro(summary.unplanned) }) : summary.debtFree ? "" : t("no plan yet"),
          href: link,
        },
      ];
      if (dir === "owe") {
        const income = monthlyIncome().amount;
        const fixed = fixedCosts().amount ?? 0;
        if (income != null) {
          const left = income - summary.monthlyRates - fixed;
          tiles.push({
            label: t("Left a month"),
            value: euro(left),
            detail: fixed ? t("of {income} income, after instalments and {fixed} fixed costs", { income: euro(income), fixed: euro(fixed) }) : t("of {amount} income a month", { amount: euro(income) }),
            href: link,
            ...{ tone: left < 0 ? ("bad" as const) : ("good" as const) },
          });
        } else tiles.push({ label: t("Left a month"), value: "—", detail: t("income not known yet"), href: link });
      }
      return { kind: "stats", tiles };
    },
  },
  {
    id: "finances.payments",
    get label() {
      return t("Payments coming up");
    },
    icon: "📆",
    get description() {
      return t("The instalments and payments of your debts (or what comes back to you) in the next weeks — the overdue first, each leading to its debt.");
    },
    get settings(): WidgetSetting[] {
      return [dirSetting(), { key: "days", label: t("Days ahead"), kind: "number", default: 45, min: 1, max: 365 }, { key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 }];
    },
    ttl: 60,
    data: (config) => {
      const dir = dirOf(config.dir);
      const until = new Date(Date.now() + Number(config.days ?? 45) * 864e5).toISOString().slice(0, 10);
      const db = debtsDbId();
      const all = debtPlans(today(), dir)
        .debts.flatMap((d) => d.plan.payments.filter((p) => p.date <= until).map((p) => ({ d, p })))
        .sort((a, b) => a.p.date.localeCompare(b.p.date));
      const items = all.slice(0, Number(config.limit ?? 8)).map(({ d, p }) => ({
        id: `${d.id}:${p.date}`,
        icon: "💶",
        text: `${d.creditor} · ${euro(p.amount, 2)}`,
        detail: [d.label ? `Az. ${d.label}` : "", d.title && d.title !== d.creditor ? d.title : ""].filter(Boolean).join(" · ") || undefined,
        meta: whenText(p.date),
        tone: inDays(p.date) < 0 ? ("bad" as const) : inDays(p.date) <= 3 ? ("warn" as const) : undefined,
        href: db ? `/workspace/${db}?row=${d.id}` : undefined,
      }));
      return {
        kind: "list",
        items,
        count: all.length || undefined,
        empty: dir === "owe" ? t("No payments due.") : t("Nothing comes back in these days."),
        ...(db ? { footer: { text: dir === "owe" ? t("Creditors overview") : t("Debtors overview"), href: `/workspace/${db}` } } : {}),
      };
    },
  },
];
