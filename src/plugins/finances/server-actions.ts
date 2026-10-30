"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { DebtPlan } from "./debts";
import type { MonthlyIncome } from "./income";
import type { DebtSuggestion, Direction } from "./own";
import type { PlanSummary } from "./plans";
import { localDay } from "@/lib/dates";
import { pluginAction, type Result } from "@/lib/action-result";

/** What the Finances plugin's pages call. None throws at the page. */

const run = pluginAction("finances", () => t("The Finances plugin is not installed (Menu → Plugins)."));

/** The debts database reads the cases again (a new or changed row shows its plan). */
async function rowsAgain(): Promise<void> {
  const db = (await import("./debts")).debtsDbId();
  if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
}

export type FinancesOverview = {
  dir: Direction;
  debts: DebtPlan[];
  summary: PlanSummary;
  income: MonthlyIncome;
  /** Your monthly fixed costs: the value published as "Fixkosten" in the Workspace (none: none). */
  fixed: import("./fixed").FixedCosts;
  contacts: { id: number; name: string; kind: "person" | "organization" }[];
  suggestions: DebtSuggestion[];
};

/** One direction's overview: its debts with their plans, the plans together, your income, the promises to write down. */
export async function financesOverviewAction(dir: Direction): Promise<Result<{ overview: FinancesOverview }>> {
  return run(async () => {
    const d: Direction = dir === "owed" ? "owed" : "owe";
    const db = (await import("./debts")).debtsDbId();
    // The cases' debts read in now (their bank payments counted).
    if (db) await (await import("@/plugins/workspace/pipeline")).runPipeline(db, { ai: false });
    const today = localDay();
    const plans = (await import("./debts")).debtPlans(today, d);
    const income = await import("./income");
    await income.refreshIncome();
    const contacts = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople().map((p) => ({ id: p.id, name: p.name, kind: p.kind })) : [];
    const suggestions = (await import("./own")).debtSuggestions().filter((s) => s.dir === d);
    return { overview: { dir: d, debts: plans.debts, summary: plans.summary, income: income.monthlyIncome(), fixed: (await import("./fixed")).fixedCosts(), contacts, suggestions } };
  });
}

/** A debt (or a claim) of your own written down: to whom (a contact, or a new one by its name), how much, by when. */
export async function createDebtAction(v: { dir?: Direction; title: string; creditorId?: number | null; creditorName?: string; creditorKind?: "person" | "organization"; amount: number | null; due: string | null; installment: number | null }): Promise<Result<{ id: number }>> {
  return run(async () => {
    const id = (await import("./own")).createDebt({ dir: v.dir === "owed" ? "owed" : "owe", title: String(v.title ?? ""), creditorId: v.creditorId ? Number(v.creditorId) : null, creditorName: v.creditorName ? String(v.creditorName) : undefined, creditorKind: v.creditorKind === "organization" ? "organization" : v.creditorKind === "person" ? "person" : undefined, amount: v.amount == null ? null : Number(v.amount), due: v.due ? String(v.due) : null, installment: v.installment == null ? null : Number(v.installment) });
    await rowsAgain();
    return { id };
  });
}

/** A promise written down — yours as a debt, theirs as a claim. */
export async function debtFromClaimAction(claimId: number): Promise<Result<{ id: number }>> {
  return run(async () => {
    const id = (await import("./own")).createDebtFromClaim(Number(claimId));
    await rowsAgain();
    return { id };
  });
}

/** A debt of your own changed: its money, its due day, the plan's day — emptied: gone. */
export async function debtMoneyAction(rowId: number, patch: { total?: number | null; open?: number | null; installment?: number | null; due?: string | null; day?: number | null }): Promise<Result> {
  return run(async () => {
    const num = (v: unknown) => (v === null ? null : v === undefined ? undefined : Number(v));
    (await import("./own")).setDebtMoney(Number(rowId), { total: num(patch.total), open: num(patch.open), installment: num(patch.installment), day: num(patch.day), ...(patch.due !== undefined ? { due: patch.due ? String(patch.due) : null } : {}) });
    return {};
  });
}

/** A debt of your own removed. */
export async function deleteDebtAction(rowId: number): Promise<Result> {
  return run(async () => {
    (await import("./own")).deleteDebt(Number(rowId));
    return {};
  });
}

/** Your monthly income as you set it (null: the statements' again). */
export async function setIncomeAction(income: number | null): Promise<Result> {
  return run(async () => {
    const n = income == null ? null : Number(income);
    (await import("./income")).setManualIncome(n != null && Number.isFinite(n) && n >= 0 ? n : null);
    return {};
  });
}

/** Settings → Finances: a recipient marked as an account of yours (own, credit) — or not any more. Back to the page. */
export async function markAccountFormAction(fd: FormData): Promise<void> {
  const { redirect } = await import("next/navigation");
  const { revalidatePath } = await import("next/cache");
  const key = String(fd.get("key") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const r = await run(async () => {
    (await import("./accounts")).markAccount(key, kind === "own" || kind === "credit" ? kind : null);
    (await import("@/plugins/workspace/metrics")).forgetMetricValues();
    return {};
  });
  revalidatePath("/settings/finances");
  redirect(`/settings/finances?${new URLSearchParams(r.ok ? { ok: t("Saved.") } : { error: r.error })}#accounts`);
}
