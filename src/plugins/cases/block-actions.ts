"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { caseBundle, caseOp, type CaseBundle, type CaseOperation } from "./blocks";

/** What a case's page calls: its bundle, an operation. None throws at the page. */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    if (!isInstalled("cases")) throw new Error(t("The Cases plugin is not installed (Menu → Plugins)."));
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

const caseId = async (rowId: number): Promise<number> => {
  const id = await (await import("./database")).caseOfRow(Number(rowId));
  if (!id) throw new Error(t("This row is not a case."));
  return id;
};

/** Everything the case's page shows. */
export async function caseBundleAction(rowId: number): Promise<Result<{ case: CaseBundle }>> {
  return run(async () => ({ case: await caseBundle(await caseId(rowId)) }));
}

/** An operation on the case; the cases database reads the cases again after it (its rows follow). */
export async function caseOpAction(rowId: number, op: CaseOperation): Promise<Result<{ message?: string }>> {
  return run(async () => {
    const r = await caseOp(await caseId(rowId), op);
    const db = await (await import("./database")).casesDatabase();
    if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    return r;
  });
}

/** The overview of the debts (the printable page), with your income for the months ahead. */
export async function debtOverviewAction(): Promise<Result<{ overview: import("./bank").DebtOverview }>> {
  return run(async () => {
    return { overview: (await import("./bank")).debtOverview() };
  });
}

/** Your monthly income, for the months ahead (null: not said). */
export async function setIncomeAction(income: number | null): Promise<Result> {
  return run(async () => {
    const n = income == null ? null : Number(income);
    (await import("./income")).setManualIncome(n != null && Number.isFinite(n) && n >= 0 ? n : null);
    return {};
  });
}

export type CasesOverview = {
  figures: { open: number; dueSoon: number; overdue: number; running: number; /** Your income a month (the knowledge read it off your statements, or yours). */ income: number | null; incomeSource: "manual" | "knowledge" | "none" };
  cases: { id: number; rowId: number | null; title: string; label: string; person: string; /** Who it is owed to, who collects it (contacts' names). */ creditor: string; collector: string; /** A debt you wrote down yourself. */ manual: boolean; open: number | null; nextDue: string | null; nextWhat: string; payment: import("./payments").CasePayment | null; summed: boolean }[];
  /** Promises of yours with an amount, to write down as debts. */
  suggestions: import("./parties").DebtSuggestion[];
  /** Your contacts (for choosing a creditor). */
  contacts: { id: number; name: string; kind: "person" | "organization" }[];
  /** The debts with their payment plans (each with its row), and the plans together. */
  plans: { debts: (import("./debts").DebtPlan & { rowId: number | null })[]; summary: import("./plans").PlanSummary };
};

/** The cases database's overview (its "Overview" view): the money in figures, the running cases by what is due first, each with where it pays to. */
export async function casesOverviewAction(): Promise<Result<{ overview: CasesOverview }>> {
  return run(async () => {
    (await import("./detect")).detectCases();
    // The statements that came in as documents (your Drive folder; the Revolut plugin), read; the payments matched.
    if (isInstalled("revolut")) (await import("@/plugins/revolut/statement")).importStatementDocuments();
    (await import("./bank")).matchPayments();
    const { listCases } = await import("./store");
    const { casePayment } = await import("./payments");
    const parties = await import("./parties");
    // Every running case's creditor and collector, as its summary names them.
    parties.assignAllParties();
    const { caseTitle } = await import("./shared");
    const db = await (await import("./database")).casesDatabase();
    const rows = new Map<string, number>();
    if (db) for (const r of (await import("@/plugins/workspace/store")).rawRows(db)) rows.set(String(r.cells.srcref ?? ""), r.id);
    const names = new Map<number, string>();
    if (isInstalled("people")) for (const p of (await import("@/plugins/people/store")).listPeople()) names.set(p.id, p.name);
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const cases = listCases()
      .filter((c) => c.status === "open" && !c.compiled?.done)
      .map((c) => ({ id: c.id, rowId: rows.get(`case:${c.id}`) ?? null, title: caseTitle(c), label: c.label, person: c.personId ? (names.get(c.personId) ?? "") : "", creditor: parties.partiesOf(c.id).creditor?.name ?? "", collector: parties.partiesOf(c.id).collector?.name ?? "", manual: !!c.compiled?.manual, open: c.compiled?.open ?? null, nextDue: c.compiled?.nextDue ?? null, nextWhat: c.compiled?.nextWhat ?? "", payment: casePayment(c.id), summed: !!c.compiled }))
      .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
    const figures = {
      open: cases.reduce((s, c) => s + (c.open ?? 0), 0),
      dueSoon: cases.filter((c) => c.nextDue && c.nextDue >= today && c.nextDue <= in30).reduce((s, c) => s + (c.payment?.amount ?? 0), 0),
      overdue: cases.filter((c) => c.nextDue && c.nextDue < today).length,
      running: cases.length,
      ...(await (async () => {
        const income = await import("./income");
        await income.refreshIncome();
        const i = income.monthlyIncome();
        return { income: i.amount, incomeSource: i.source };
      })()),
    };
    const contacts = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople().map((p) => ({ id: p.id, name: p.name, kind: p.kind })) : [];
    const plans = (await import("./debts")).debtPlans(today);
    return { overview: { figures, cases, suggestions: parties.debtSuggestions(), contacts, plans: { debts: plans.debts.map((d) => ({ ...d, rowId: rows.get(`case:${d.id}`) ?? null })), summary: plans.summary } } };
  });
}

/** The cases database reads the cases again (a new or changed debt shows as its row). */
async function rowsAgain(): Promise<void> {
  const db = await (await import("./database")).casesDatabase();
  if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
}

/** A debt of your own written down (no case number): to whom (a contact, or a new one by its name), how much, by when. */
export async function createDebtAction(v: { title: string; creditorId?: number | null; creditorName?: string; creditorKind?: "person" | "organization"; amount: number | null; due: string | null; installment: number | null }): Promise<Result<{ id: number }>> {
  return run(async () => {
    const id = (await import("./parties")).createDebt({ title: String(v.title ?? ""), creditorId: v.creditorId ? Number(v.creditorId) : null, creditorName: v.creditorName ? String(v.creditorName) : undefined, creditorKind: v.creditorKind === "organization" ? "organization" : v.creditorKind === "person" ? "person" : undefined, amount: v.amount == null ? null : Number(v.amount), due: v.due ? String(v.due) : null, installment: v.installment == null ? null : Number(v.installment) });
    await rowsAgain();
    return { id };
  });
}

/** A case's money corrected by you (a debt of yours, or one the AI summed up): it stays over what the AI sums up later; null takes it back. */
export async function caseMoneyAction(caseId: number, patch: { total?: number | null; open?: number | null; installment?: number | null; due?: string | null }): Promise<Result> {
  return run(async () => {
    const num = (v: unknown) => (v === null ? null : v === undefined ? undefined : Number(v));
    (await import("./parties")).setDebtMoney(Number(caseId), { total: num(patch.total), open: num(patch.open), installment: num(patch.installment), ...(patch.due !== undefined ? { due: patch.due ? String(patch.due) : null } : {}) });
    await rowsAgain();
    return {};
  });
}

/** A debt of your own removed. */
export async function deleteDebtAction(caseId: number): Promise<Result> {
  return run(async () => {
    (await import("./parties")).deleteDebt(Number(caseId));
    await rowsAgain();
    return {};
  });
}

/** A promise of yours written down as a debt. */
export async function debtFromClaimAction(claimId: number): Promise<Result<{ id: number }>> {
  return run(async () => {
    const id = (await import("./parties")).createDebtFromClaim(Number(claimId));
    await rowsAgain();
    return { id };
  });
}

export type BankStatus = { /** Statements can be imported (the Revolut plugin). */ statements: boolean; configured: boolean; connected: boolean; appId: string; aspsp: string; country: string; validUntil: string | null; lastSync: string | null; transactions: number };

/** How the bank connection stands (the key is never sent to the page). */
export async function bankStatusAction(): Promise<Result<{ bank: BankStatus }>> {
  return run(async () => {
    const sync = await import("./bank-sync");
    const s = sync.bankSettings();
    const { listTransactions } = await import("./bank");
    return { bank: { statements: isInstalled("revolut"), configured: !!(s?.appId && s.privateKey), connected: sync.bankConnected(), appId: s?.appId ?? "", aspsp: s?.aspsp ?? "Revolut", country: s?.country ?? "DE", validUntil: s?.validUntil ?? null, lastSync: s?.lastSync ?? null, transactions: listTransactions(100000).length } };
  });
}

/** The application's id and key (empty key: the one kept stays), the bank and its country. */
export async function saveBankSettingsAction(v: { appId: string; privateKey?: string; aspsp: string; country: string }): Promise<Result> {
  return run(async () => {
    (await import("./bank-sync")).saveBankSettings({ appId: String(v.appId ?? ""), privateKey: v.privateKey ? String(v.privateKey) : undefined, aspsp: String(v.aspsp ?? "Revolut"), country: String(v.country ?? "DE") });
    return {};
  });
}

/** Where to sign in at your bank — it comes back to Zeff's /api/bank/callback. */
export async function startBankAuthAction(): Promise<Result<{ url: string }>> {
  return run(async () => {
    const { headers } = await import("next/headers");
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    return { url: (await (await import("./bank-sync")).startBankAuth(`${origin}/api/bank/callback`)).url };
  });
}

/** The bookings fetched now, matched, the late instalments warned of. */
export async function syncBankAction(): Promise<Result<{ message: string }>> {
  return run(async () => {
    const r = await (await import("./bank-sync")).syncBank();
    const bank = await import("./bank");
    const m = bank.matchPayments();
    const w = bank.overdueWarnings(new Date().toISOString().slice(0, 10));
    return { message: t("{added} new bookings of {total} — {matched} payments matched, {warned} warnings", { added: r.added, total: r.total, matched: m.matched, warned: w }) };
  });
}
