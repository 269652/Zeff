import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";

/**
 * Your monthly income (the Finances plugin), as the knowledge server read it off your bank statements when it compiled them (a
 * page per account and month goes to it — knowledge-docs.ts): its "net income" of each month, the average of the last three
 * whole months. What it read is kept here (read again after each briefing and when the debt overview opens), so the pages
 * have it at once. What you set yourself goes first. Server only.
 */

const MANUAL = "cases.income";
const READ = "cases.incomeFacts";

export type IncomeFact = { period: string; amount: number; text: string; pageTitle: string };

/** Your income as you set it (null: the knowledge's). */
export const setManualIncome = (v: number | null) => setPref(MANUAL, v != null && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

/** What the knowledge read about your income, read again (`read`: for tests) — kept; the knowledge not answering: what was kept stays. */
export async function refreshIncome(opts: { read?: () => Promise<{ key: string; period: string; amount: number; text: string; pageTitle: string }[]> } = {}): Promise<{ ok: boolean }> {
  if (!opts.read && !isInstalled("knowledge")) return { ok: false };
  try {
    const read = opts.read ?? (async () => (await import("@/plugins/knowledge/client")).knowledgeProfile("net_income"));
    const facts = (await read()).filter((f) => f.key === "net_income").map((f) => ({ period: f.period, amount: f.amount, text: f.text, pageTitle: f.pageTitle }));
    setPref(READ, facts);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type MonthlyIncome = {
  /** What counts: yours when you set it, else the knowledge's. Null: none known. */
  amount: number | null;
  source: "manual" | "knowledge" | "none";
  /** The knowledge's figure (beside yours). */
  derived: number | null;
  /** The last three whole months the knowledge knows, the oldest first — with where each figure is from. */
  months: { month: string; amount: number; text: string; pageTitle: string }[];
};

/** Your monthly income: yours, else the average of the last three whole months the knowledge read off your statements. */
export function monthlyIncome(today = new Date()): MonthlyIncome {
  const manual = getPref<number | null>(MANUAL, null);
  const running = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const facts = getPref<IncomeFact[]>(READ, [])
    .filter((f) => f.period < running)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 3);
  const derived = facts.length ? Math.round((facts.reduce((s, f) => s + f.amount, 0) / facts.length) * 100) / 100 : null;
  return {
    amount: manual ?? derived,
    source: manual != null ? "manual" : derived != null ? "knowledge" : "none",
    derived,
    months: facts.map((f) => ({ month: f.period, amount: f.amount, text: f.text, pageTitle: f.pageTitle })).reverse(),
  };
}
