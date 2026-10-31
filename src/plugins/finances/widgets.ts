import { t } from "@/lib/i18n/server";
import { statsBadge, type WorkspaceWidget, type WidgetSetting } from "@/plugins/workspace/widget-point";
import { metricStats, namesSetting } from "@/plugins/workspace/widgets-metrics";
import { debtPlans, debtsDbId } from "./debts";
import type { Direction } from "./own";
import type { Rhythm } from "./recurring";
import { localDay } from "@/lib/dates";

/**
 * The widgets of Finances: your debts (or what you are owed) in figures — open, the instalments a month, when you are free of
 * them, what is left of your income — and the payments coming up, each leading to its row in the debts database. Server only.
 */

const euro = (v: number, digits = 0) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
const today = () => localDay();
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
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const rhythmText = (r: Rhythm) => ({ monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") })[r];
/** "1.234,56" or "-80" as you type it (empty, or no number: null). */
const typedAmount = (v: unknown) => {
  const s = String(v ?? "").replace(/[€\s]/g, "");
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return s && Number.isFinite(n) ? n : null;
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
      return [dirSetting(), namesSetting()];
    },
    size: "full",
    ttl: 60,
    // Its figures are the Finances Kennzahlen (metrics.ts) — the same numbers as @Schuldenstand, kennzahl("Tilgungsrate").
    data: (config) =>
      metricStats(
        config.names,
        dirOf(config.dir) === "owe"
          ? [
              { name: "Schuldenstand", detail: "Offene Schulden" },
              { name: "Tilgungsrate" },
              { name: "Schuldenfrei in", detail: "Schulden ohne Plan" },
              { name: "Frei im Monat", detail: "Fixkosten" },
            ]
          : [{ name: "Forderungen", detail: "Offene Forderungen" }, { name: "Rückzahlungen" }, { name: "Alles zurück in", detail: "Forderungen ohne Plan" }],
        t("No metrics yet — Workspace → Metrics."),
      ),
    // The page's badge: a figure gone wrong.
    badge: statsBadge((figure) => t("{figure} needs a look", { figure })),
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
      const until = localDay(new Date(Date.now() + Number(config.days ?? 45) * 864e5));
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
  {
    id: "finances.subscriptions",
    get label() {
      return t("Subscriptions not in your contracts");
    },
    icon: "🔁",
    get description() {
      return t("What goes out regularly — every month, quarter or year, about the same amount — but isn't in your contracts database: each with its cost a month and next payment, one click adds it there.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 }];
    },
    ttl: 300,
    data: async (config) => {
      const { contractsTarget, missingSubscriptions } = await import("./insights-data");
      const { items: all, running } = missingSubscriptions();
      const target = contractsTarget();
      const items = all.slice(0, Number(config.limit ?? 8)).map((r) => ({
        id: r.key,
        icon: "🔁",
        text: `${r.name} · ${euro(r.amount, 2)}`,
        detail: [rhythmText(r.rhythm), r.rhythm !== "monthly" ? t("{amount} a month", { amount: euro(r.monthly, 2) }) : "", t("last {date}", { date: shortDay(r.last) })].filter(Boolean).join(" · "),
        meta: t("next {date}", { date: shortDay(r.next) }),
        ...(target ? { actions: [{ id: "add", label: t("Add to {db}", { db: target.title }), icon: "+" }] } : {}),
      }));
      const monthly = all.reduce((s, r) => s + r.monthly, 0);
      return {
        kind: "list",
        items,
        ...(all.length ? { title: t("{n} of {running} running, {amount} a month", { n: all.length, running, amount: euro(monthly) }), count: all.length } : {}),
        empty: running ? t("Every subscription is in your contracts.") : t("No recurring payments in your bank bookings."),
        ...(target ? { footer: { text: target.title, href: `/workspace/${target.dbId}` } } : {}),
      };
    },
    act: async (action, payload) => {
      if (action !== "add") throw new Error("unknown action");
      (await import("./insights-data")).addSubscriptionRow(String(payload.id));
    },
  },
  {
    id: "finances.cashflow",
    get label() {
      return t("Cashflow ahead");
    },
    icon: "📈",
    get description() {
      return t("Your account in the next weeks: what comes in regularly, the fixed costs, subscriptions, instalments and payments ahead — the balance week by week and the first day it drops below zero (or your buffer).");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "balance", label: t("Balance today (empty: only the net a month)"), kind: "text", default: "" },
        { key: "buffer", label: t("Buffer (warn below)"), kind: "number", default: 0, min: 0, max: 100000 },
        { key: "days", label: t("Days ahead"), kind: "number", default: 90, min: 14, max: 180 },
      ];
    },
    size: "full",
    ttl: 300,
    data: async (config) => {
      const start = typedAmount(config.balance);
      const buffer = Number(config.buffer ?? 0) || 0;
      const f = (await import("./insights-data")).cashflowForecast({ start, buffer, days: Number(config.days ?? 90) });
      const i = f.inputs;
      const title = t("From {incomes} incomes, {subscriptions} subscriptions, {contracts} other contracts and {payments} debts", i);
      const months = f.months.map((m) => ({
        id: m.month,
        icon: "🗓️",
        text: monthYear(m.month),
        detail: t("in {in} · out {out}", { in: euro(m.in), out: euro(m.out) }),
        badge: euro(m.net),
        tone: m.net < 0 ? ("bad" as const) : ("good" as const),
      }));
      if (!i.incomes && !i.subscriptions && !i.contracts && !i.payments) return { kind: "list", items: [], empty: t("Nothing known ahead yet — no bank bookings, contracts or debts.") };
      if (f.start == null) return { kind: "list", title, items: [{ id: "hint", icon: "💡", text: t("Net a month"), detail: t("Write your balance today in the widget's settings for the weeks ahead and the day it runs low."), wrap: true }, ...months] };
      const low = f.firstBelowBuffer;
      const verdict = low
        ? {
            text: f.firstNegative && f.firstNegative.date === low.date ? t("Below zero on {date}", { date: shortDay(low.date) }) : t("Below {buffer} on {date}", { buffer: euro(buffer), date: shortDay(low.date) }),
            detail: t("{amount} then · in {n} days", { amount: euro(low.balance), n: inDays(low.date) }),
            tone: f.firstNegative ? ("bad" as const) : ("warn" as const),
          }
        : { text: t("Stays above {amount}", { amount: euro(buffer) }), detail: f.lowest ? t("lowest {amount} on {date}", { amount: euro(f.lowest.balance), date: shortDay(f.lowest.date) }) : undefined, tone: "good" as const };
      const weeks = {
        id: "weeks",
        icon: low ? "⚠️" : "📈",
        ...verdict,
        badge: `${euro(f.start)} → ${euro(f.end ?? f.start)}`,
        mini: { bars: f.weeks.map((w) => ({ label: shortDay(w.to), value: Math.round(w.balance ?? 0), tone: (w.balance ?? 0) < 0 ? ("bad" as const) : (w.balance ?? 0) < buffer ? ("warn" as const) : undefined })), unit: "€" },
      };
      return { kind: "list", title, items: [weeks, ...months] };
    },
  },
];
