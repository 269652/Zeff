import { getPref } from "@/lib/prefs";
import { detailsOf } from "@/plugins/people/details";
import { getPerson } from "@/plugins/people/store";
import { isInstalled } from "@/plugins/state";
import { getDatabase, rawRows } from "@/plugins/workspace/store";
import type { Row } from "@/plugins/workspace/model";
import { caseStanding } from "@/plugins/cases/bank";
import { casePayment, type CasePayment } from "@/plugins/cases/payments";
import { DEBT } from "./fields";
import type { Direction } from "./own";
import { schedule, summarize, type PlanSummary, type Schedule } from "./plans";

/**
 * Your debts and what you are owed, with their payment plans (the Finances plugin), read off the debts database — your own rows
 * and the cases' — with the plans together per direction (a month's instalments, when it is all paid, what has no plan, the
 * months ahead). Server only.
 */

export type DebtPlan = {
  /** The row's id (its page in the Workspace). */
  id: number;
  /** You owe it, or it is owed to you. */
  dir: Direction;
  /** The case it comes from (null: a row of your own). */
  caseId: number | null;
  title: string;
  /** The case number ("" for your own). */
  label: string;
  creditor: string;
  creditorId: number | null;
  collector: string;
  /** A row of your own: its figures yours to change. */
  manual: boolean;
  total: number | null;
  open: number;
  installment: number | null;
  nextDue: string | null;
  day: number | null;
  nextWhat: string;
  payment: CasePayment | null;
  plan: Schedule;
  /** How to reach them (who collects it, else the creditor): name, mail, phone, address. */
  contact: string;
  iban: string;
  /** The last payment the bank shows (a case's). */
  last: { date: string; amount: number } | null;
};

/** The debts database's id — null: not made (yet), or gone. */
export function debtsDbId(): number | null {
  const id = getPref<number | null>("workspace.debtsDb", null);
  const d = id ? getDatabase(id) : null;
  return d && !d.page.archivedAt ? id : null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const firstId = (v: unknown) => (Array.isArray(v) && typeof v[0] === "number" ? v[0] : null);
const dayOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String((v as { start: string }).start).slice(0, 10) : null);

function planOf(r: Row, today: string): DebtPlan | null {
  const open = num(r.cells[DEBT.open]);
  if (open == null || open <= 0) return null;
  const ref = /^case:(\d+)$/.exec(String(r.cells.srcref ?? ""));
  const caseId = ref ? Number(ref[1]) : null;
  const people = isInstalled("people");
  const creditorId = firstId(r.cells[DEBT.creditor]);
  const collectorId = firstId(r.cells[DEBT.collector]);
  const creditor = creditorId && people ? getPerson(creditorId) : null;
  const collector = collectorId && people ? getPerson(collectorId) : null;
  const reach = collector ?? creditor;
  const details = reach && people ? detailsOf(reach.id) : [];
  const installment = num(r.cells[DEBT.rate]);
  const nextDue = dayOf(r.cells[DEBT.due]);
  const day = num(r.cells[DEBT.day]);
  // Where to pay: the case's account — else (a row of your own) the creditor's.
  const own = creditor && people ? detailsOf(creditor.id) : [];
  const iban = own.find((d) => d.key === "iban")?.value ?? "";
  const payment = caseId ? casePayment(caseId) : iban && creditor ? { name: creditor.name, iban, bic: own.find((d) => d.key === "bic")?.value ?? "", purpose: r.title, amount: installment ?? open } : null;
  return {
    id: r.id,
    dir: r.cells[DEBT.dir] === "owed" ? "owed" : "owe",
    caseId,
    title: r.title,
    label: caseId ? String(r.cells[DEBT.case] ?? "") : "",
    creditor: creditor?.name ?? (r.title || "—"),
    creditorId,
    collector: collector?.name ?? "",
    manual: !caseId,
    total: num(r.cells[DEBT.total]),
    open,
    installment,
    nextDue,
    day,
    nextWhat: String(r.cells[DEBT.next] ?? ""),
    payment,
    plan: schedule({ open, installment, nextDue, day }, today),
    contact: [reach?.name, ...(reach?.emails ?? []), ...details.filter((x) => x.key === "phone" || x.key === "address").map((x) => x.value)].filter(Boolean).join(" · "),
    iban: payment?.iban ?? "",
    last: caseId ? caseStanding(caseId).last : null,
  };
}

/** The debts of one direction (you owe them — or, "owed", what you are owed) with their plans, and the plans together. */
export function debtPlans(today = new Date().toISOString().slice(0, 10), dir: Direction = "owe"): { debts: DebtPlan[]; summary: PlanSummary } {
  const db = debtsDbId();
  const debts = db ? rawRows(db).flatMap((r) => planOf(r, today) ?? []).filter((d) => d.dir === dir) : [];
  // The next due first, those without a day last.
  debts.sort((a, b) => (a.plan.payments[0]?.date ?? "9999").localeCompare(b.plan.payments[0]?.date ?? "9999"));
  return { debts, summary: summarize(debts.map((d) => ({ id: d.id, ...d.plan })), today) };
}

/** Between you and each contact: what you owe them and what they owe you (open, in all), by their id. */
export function balances(): Map<number, { owe: number; owed: number }> {
  const out = new Map<number, { owe: number; owed: number }>();
  for (const dir of ["owe", "owed"] as const)
    for (const d of debtPlans(undefined, dir).debts) {
      if (!d.creditorId) continue;
      const x = out.get(d.creditorId) ?? { owe: 0, owed: 0 };
      x[dir] = Math.round((x[dir] + d.open) * 100) / 100;
      out.set(d.creditorId, x);
    }
  return out;
}
