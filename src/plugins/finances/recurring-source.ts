import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { CONTRACT } from "@/plugins/workspace/contract-fields";
import type { SourceRecord } from "@/plugins/workspace/pipeline";
import { markedAccounts } from "./accounts";
import { movedOnly } from "./insights";
import { detectRecurring, STRICT, type Rhythm } from "./recurring";
import { addDays, localDay } from "@/lib/dates";

/**
 * The recurring payments as records of the Workspace (the Finances plugin's source "recurring"): each running contract or
 * subscription your statements show — a row of a contracts database, its figures what the bank says (locked there), the rest
 * of the row yours. Server only.
 */
export async function recurringRecords(today = localDay()): Promise<SourceRecord[]> {
  let all: { date: string; amount: number; text: string; counterparty: string }[] = [];
  try {
    // The last two years and a bit — enough for a yearly one to show twice (both directions: money that comes back is moved).
    const from = addDays(today, -800);
    all = getSqlite().prepare("select date, amount, text, counterparty from bank_transactions where date >= ? order by date").all(from) as typeof all;
  } catch {
    return [];
  }
  // What is no contract: money only moved (a pocket, savings, an account of your own — it comes back too), the bank's own pocket
  // moves by their words ("… einzustecken", round-ups), and money to a person you know.
  const moved = movedOnly(all);
  const POCKET = /einzustecken|pocket|spartopf|ersparnis|round[- ]?up|aufrund|sparen|savings|vault/i;
  const people = new Set<string>();
  try {
    if ((await import("@/plugins/state")).isInstalled("people")) for (const p of (await import("@/plugins/people/store")).listPeople()) people.add(p.name.trim().toLowerCase());
  } catch {
    // no people: none
  }
  const rows = all.filter((b) => b.amount < 0 && !POCKET.test(`${b.text} ${b.counterparty}`) && !people.has(b.counterparty.trim().toLowerCase()));
  const label: Record<Rhythm, string> = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") };
  // An account you marked as yours (your own, a credit account) is no contract.
  const marked = markedAccounts();
  // (The strict reading, as the Finances overview's: a few payments of a rhythm, not two of something.)
  return detectRecurring(rows, today, STRICT)
    .filter((r) => r.active && !marked[r.key] && !moved.has(r.key))
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
