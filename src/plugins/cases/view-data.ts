import type { T } from "@/lib/i18n/shared";
import type { CasesOverview } from "./block-actions";

/**
 * What the cases view's template reads as app.* (view-template.ts): the figures, where the creditors overview is, and each running
 * case as a line of the list — its name and what it is in words, the next step written out, whether it is overdue, whether its
 * GiroCode is open (state.paying). Client-safe; the parts read the overview itself (app.overview).
 */

const day = (iso: string, locale?: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale);

export function casesAppData(o: CasesOverview, v: { t: T; today: string; paying: string; locale?: string }): Record<string, unknown> {
  const { t, today, locale } = v;
  return {
    loading: false,
    open: o.figures.open,
    dueSoon: o.figures.dueSoon,
    running: o.figures.running,
    overdue: o.figures.overdue,
    debtsUrl: o.debtsDb ? `/workspace/${o.debtsDb}` : "",
    cases: o.cases.map((c) => ({
      id: c.id,
      rowId: c.rowId,
      label: c.label,
      // Who it is owed to first; without one, what the case is called.
      name: c.creditor || c.title,
      sub: [c.creditor ? c.title : "", c.collector ? t("via {name}", { name: c.collector }) : "", !c.creditor ? c.person : ""].filter(Boolean).join(" · "),
      open: c.open,
      hasDue: !!c.nextDue,
      due: c.nextDue ? day(c.nextDue, locale) : "",
      overdue: !!c.nextDue && c.nextDue < today,
      nextWhat: c.nextWhat,
      summed: c.summed,
      payment: !!c.payment,
      paying: !!c.payment && v.paying === String(c.id),
    })),
    overview: o,
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const CASES_APP_DATA =
  "app.loading, app.error (while loading), app.open (the money the running cases hold), app.dueSoon (due in 30 days), app.running (cases running), app.overdue (cases overdue), app.debtsUrl (the Finances plugin's creditors overview, else empty), app.cases (by what is due first; each: id, rowId (its row, may be null), label (the reference), name (creditor, else the case's title), sub (what it is, who collects it, in words), open (money, may be null), hasDue, due (the next date written out), overdue, nextWhat, summed (the letters read), payment (an account known), paying (its GiroCode open)). State: state.paying (the case whose GiroCode is open).";
