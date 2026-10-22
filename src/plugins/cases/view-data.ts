import type { T } from "@/lib/i18n/shared";
import type { CasesOverview } from "./block-actions";
import type { CaseBundle } from "./blocks";
import type { PartyRole } from "./parties";

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

/**
 * What a case's own page reads as app.* (row-template.meta.ts): the header (its number, who it is with), where it stands and the
 * money, its todos, how many mails and letters, where it pays to and what the bank shows paid, its parties. Client-safe; the parts read
 * the bundle itself (app.bundle).
 */
export function caseAppData(d: CaseBundle, v: { t: T; busy: boolean; locale?: string }): Record<string, unknown> {
  const s = d.compiled;
  const link = (p: { name: string; href: string } | null | undefined) => (p ? { name: p.name, href: p.href } : null);
  const party = (role: PartyRole) => {
    const p = d.parties[role];
    return p ? { name: p.name, href: p.href, ai: p.source === "ai" } : null;
  };
  return {
    loading: false,
    label: d.label,
    manual: d.manual,
    creditor: link(d.parties.creditor),
    collector: link(d.parties.collector),
    person: link(d.person),
    // Without a creditor, who the summary names.
    party: !d.parties.creditor ? (s?.party ?? "") : "",
    status: d.status,
    canCompile: d.canCompile,
    busy: v.busy,
    summed: !!s,
    compiling: d.compiling,
    summary: s?.summary ?? "",
    total: s?.total ?? null,
    open: d.openNow ?? s?.open ?? null,
    installment: s?.installment ?? null,
    next: s?.nextDue ? `${day(s.nextDue, v.locale)}${s.nextWhat ? ` · ${s.nextWhat}` : ""}` : "",
    todos: d.todos.map((x) => ({ id: x.id, ref: x.ref, href: `/t/${x.id}`, text: x.text, done: x.done, due: x.due && !x.done ? day(x.due, v.locale) : "" })),
    mails: d.counts.mail,
    letters: d.counts.doc,
    hasSources: d.sources.length > 0,
    payment: !!d.payment,
    paid: [...d.paid].reverse().map((p) => ({ date: day(p.date, v.locale), amount: p.amount })),
    parties: { creditor: party("creditor"), collector: party("collector"), payee: party("payee") },
    bundle: d,
  };
}

/** What a case's page holds as app.* — the AI and the language's help read it. */
export const CASE_APP_DATA =
  "app.loading, app.error (while loading), app.label (the case number), app.manual (a debt of your own: no number, never summed up), app.creditor, app.collector, app.person (each null or {name, href}: its page — test with app.creditor.name), app.party (who the summary names, when there is no creditor), app.status (open, closed, ignored), app.canCompile (the LLM plugin there), app.busy (an operation running), app.summed, app.compiling (being summed up now), app.summary, app.total, app.open (after the bank's payments), app.installment (money, may be null), app.next (the next date and what it is, written out; may be empty), app.todos (each: id, ref, href, text, done, due), app.mails, app.letters (how many), app.hasSources, app.payment (an account known), app.paid (the bank's payments, newest first; each: date, amount), app.parties.creditor / .collector / .payee (each null or {name, href, ai: as the AI read it}).";
