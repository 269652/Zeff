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
  type B = { date: string; amount: number; text: string; counterparty: string; iban: string; person_id: number | null };
  let all: B[] = [];
  try {
    // The last two years and a bit — enough for a yearly one to show twice (both directions: money that comes back is moved).
    const from = addDays(today, -800);
    // (The bank's table made, with whom each booking went to — cases/bank.ts.)
    (await import("@/plugins/cases/bank")).listTransactions(1);
    all = getSqlite().prepare("select date, amount, text, counterparty, iban, person_id from bank_transactions where date >= ? order by date").all(from) as B[];
  } catch {
    return [];
  }
  // What is no contract: money only moved (a pocket, savings, an account of your own — it comes back too), the bank's own pocket
  // moves by their words ("… einzustecken", round-ups), and money to a person you know (by the booking's person — its account or
  // its name, people/resolve.ts; an organisation among your contacts can be a contract).
  const moved = movedOnly(all);
  const POCKET = /einzustecken|pocket|spartopf|ersparnis|round[- ]?up|aufrund|sparen|savings|vault/i;
  const persons = new Set<number>();
  let who: import("@/plugins/people/resolve").PersonResolver | null = null;
  try {
    if ((await import("@/plugins/state")).isInstalled("people")) {
      who = (await import("@/plugins/people/resolve")).makePersonResolver();
      for (const p of who.people) if (p.kind !== "organization") persons.add(p.id);
    }
  } catch {
    // no people: none
  }
  const toPerson = (b: B) => {
    const id = b.person_id ?? who?.byIban(b.iban) ?? null;
    return id !== null && persons.has(id);
  };
  const rows = all.filter((b) => b.amount < 0 && !POCKET.test(`${b.text} ${b.counterparty}`) && !toPerson(b));
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
