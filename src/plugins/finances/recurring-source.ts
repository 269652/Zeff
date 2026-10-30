import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { CONTRACT } from "@/plugins/workspace/contract-fields";
import type { SourceRecord } from "@/plugins/workspace/pipeline";
import { markedAccounts } from "./accounts";
import { detectRecurring, type Rhythm } from "./recurring";
import { addDays, localDay } from "@/lib/dates";

/**
 * The recurring payments as records of the Workspace (the Finances plugin's source "recurring"): each running contract or
 * subscription your statements show — a row of a contracts database, its figures what the bank says (locked there), the rest
 * of the row yours. Server only.
 */
export function recurringRecords(today = localDay()): SourceRecord[] {
  let rows: { date: string; amount: number; text: string; counterparty: string }[] = [];
  try {
    // The last two years and a bit — enough for a yearly one to show twice.
    const from = addDays(today, -800);
    rows = getSqlite().prepare("select date, amount, text, counterparty from bank_transactions where amount < 0 and date >= ? order by date").all(from) as typeof rows;
  } catch {
    return [];
  }
  const label: Record<Rhythm, string> = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") };
  // An account you marked as yours (your own, a credit account) is no contract.
  const marked = markedAccounts();
  return detectRecurring(rows, today)
    .filter((r) => r.active && !marked[r.key])
    .map((r) => ({
      ref: `recurring:${r.key}`,
      title: r.name,
      fields: {},
      updatedAt: r.last,
      typed: [
        { id: CONTRACT.monthly, name: "Per month", type: "number" as const, format: "euro" as const, value: r.monthly },
        { id: CONTRACT.amount, name: "Per payment", type: "number" as const, format: "euro" as const, value: r.amount },
        { id: CONTRACT.rhythm, name: "Rhythm", type: "select" as const, value: label[r.rhythm] },
        { id: CONTRACT.last, name: "Last paid", type: "date" as const, value: r.last },
        { id: CONTRACT.next, name: "Next payment", type: "date" as const, value: r.next },
      ],
    }));
}
