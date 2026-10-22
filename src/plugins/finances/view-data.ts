import type { T } from "@/lib/i18n/shared";
import type { FinancesOverview } from "./server-actions";
import { creditorColors } from "./ui/colors";

/**
 * What the debts view's template reads as app.* (view-template.ts): the overview's figures and lists, worked out — the open, the
 * instalments, debt-free, what is left, each debt as a line of a table (its creditor's colour, what it is, its plan in words), the
 * creditors and the fixed costs for the charts. Client-safe; the parts read the overview itself (app.overview).
 */

const euro = (v: number, digits = 0, locale?: string) => v.toLocaleString(locale, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, " ");
const day = (iso: string, locale?: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale);
const monthYear = (iso: string, long: boolean, locale?: string) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString(locale, { month: long ? "long" : "short", year: "numeric" });

export function debtsAppData(o: FinancesOverview, v: { t: T; withFixed: boolean; today: string; locale?: string }): Record<string, unknown> {
  const { t, locale, today } = v;
  const owe = o.dir === "owe";
  const s = o.summary;
  const income = o.income.amount;
  const fixed = owe && v.withFixed ? o.fixed.amount : null;
  const fixedOn = fixed != null;
  const open = o.debts.reduce((a, d) => a + d.open, 0);
  const total = o.debts.reduce((a, d) => a + (d.total ?? d.open), 0);
  const ratesAll = o.debts.reduce((a, d) => a + (d.plan.kind === "plan" ? (d.installment ?? 0) : 0), 0);
  const later = Math.round((ratesAll - s.monthlyRates) * 100) / 100;
  const left = income != null ? income - s.monthlyRates - (fixed ?? 0) : null;
  const months = s.debtFree ? (Number(s.debtFree.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(s.debtFree.slice(5, 7)) - Number(today.slice(5, 7)) : null;
  // A colour per creditor, the most open first (several debts with one creditor: one).
  const byWhom = new Map<number, { key: number; name: string; amount: number }>();
  for (const d of o.debts) {
    const k = d.creditorId ?? -d.id;
    const x = byWhom.get(k) ?? { key: k, name: d.creditor, amount: 0 };
    byWhom.set(k, { ...x, amount: x.amount + d.open });
  }
  const ranked = [...byWhom.values()].sort((a, b) => b.amount - a.amount);
  const colors = creditorColors(ranked.map((x) => x.key));
  const what = (d: FinancesOverview["debts"][number]) => [d.label ? `Az. ${d.label}` : t("own"), d.collector ? t("via {name}", { name: d.collector }) : "", d.title && d.title !== d.creditor ? d.title : ""].filter(Boolean).join(" · ");
  const contact = (d: FinancesOverview["debts"][number]) => [d.contact.startsWith(d.creditor) ? d.contact.slice(d.creditor.length).replace(/^\s*·\s*/, "") : d.contact, d.iban].filter(Boolean).join(" · ");
  const debtFreeNote = s.debtFree ? [months ? t("in {n} months", { n: months }) : "", s.unplanned > 0 ? t("{amount} without a plan not in it", { amount: euro(s.unplanned, 0, locale) }) : ""].filter(Boolean).join(" · ") : t("no plan yet");
  return {
    loading: false,
    owe,
    dir: o.dir,
    asOf: new Date(`${today}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
    open,
    total,
    rates: s.monthlyRates,
    ratesAll,
    ratesNote: later > 0 ? t("running now — {amount} more starting later", { amount: euro(later, 0, locale) }) : t("running now"),
    ratesRunningNote: later > 0 ? t("running now {amount}", { amount: euro(s.monthlyRates, 2, locale) }) : "",
    fixed,
    fixedOn,
    hasFixed: o.fixed.amount != null,
    fixedTotal: o.fixed.amount,
    running: s.monthlyRates + (fixed ?? 0),
    income,
    left,
    leftTone: left == null ? "plain" : left < 0 ? "bad" : "good",
    debtFree: s.debtFree ? monthYear(s.debtFree, true, locale) : null,
    debtFreeNote,
    nextAmount: s.next?.amount ?? null,
    nextDate: s.next ? day(s.next.date, locale) : "",
    nextOverdue: !!s.next && s.next.date < today,
    estimated: o.debts.some((d) => d.plan.estimatedStart),
    hasMonths: s.months.some((m) => m.amount > 0),
    chartCols: owe && fixedOn && o.fixed.items.length ? 3 : 2,
    debts: o.debts.map((d) => {
      const color = colors[d.creditorId ?? -d.id];
      const kind = d.plan.kind;
      const n = d.plan.payments.length;
      return {
        id: d.id,
        creditor: d.creditor,
        color,
        what: what(d),
        contact: contact(d),
        total: d.total,
        open: d.open,
        installment: d.installment,
        nextWhat: d.nextWhat,
        overdue: d.plan.payments.some((p) => p.date < today),
        noPlan: kind === "none",
        plan: kind === "none" ? t("no plan") : kind === "once" ? t("once") : n === 1 ? t("1 instalment left") : t("{n} instalments left", { n }),
        planUntil: kind === "plan" && d.plan.end ? `${t("until {month}", { month: monthYear(d.plan.end, false, locale) })}${d.plan.estimatedStart ? " *" : ""}` : "",
        lastDate: d.last ? day(d.last.date, locale) : "",
        lastAmount: d.last?.amount ?? null,
        manual: d.manual,
        canPay: owe && !!d.payment,
        paid: d.total != null && d.total > 0 ? Math.max(0, Math.min(1, 1 - d.open / d.total)) : null,
      };
    }),
    creditors: ranked.map((x) => ({ name: x.name, amount: x.amount, color: colors[x.key] })),
    fixedItems: o.fixed.items.map((x) => ({ name: x.title, amount: x.amount, color: x.color, source: x.source })),
    fixedSources: [...new Set(o.fixed.items.map((x) => x.source))].join(", "),
    overview: o,
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const DEBTS_APP_DATA =
  "app.loading, app.owe (true: the creditors overview — what you owe; false: who owes you), app.dir, app.asOf (today, written out), app.open, app.total, app.rates (instalments a month running now), app.ratesAll, app.ratesNote, app.ratesRunningNote, app.fixed (the fixed costs a month when counted in, else null), app.fixedOn, app.hasFixed, app.fixedTotal, app.running (instalments + fixed costs), app.income, app.left (income − instalments − fixed costs), app.leftTone (good|bad|plain), app.debtFree (month written out), app.debtFreeNote, app.nextAmount, app.nextDate, app.nextOverdue, app.estimated, app.hasMonths, app.chartCols (2 or 3), app.debts (each: id, creditor, color, what, contact, total, open, installment, nextWhat, overdue, noPlan, plan, planUntil, lastDate, lastAmount, manual, canPay, paid 0…1), app.creditors (name, amount, color), app.fixedItems (name, amount, color, source), app.fixedSources. State: state.dir (owe|owed), state.fixed (\"true\": fixed costs counted in).";
