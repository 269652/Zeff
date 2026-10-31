import { isInstalled } from "@/plugins/state";
import { accountFor } from "@/lib/girocode";
import { paymentForTodo } from "@/lib/girocode-todo";
import type { TodoOp } from "@/lib/todos/shared";
import { listTodos, setTodoOps } from "@/lib/todos/store";
import { detailsOf, payees } from "@/plugins/people/details";
import { claimsOf } from "@/plugins/people/graph";
import { getPerson } from "@/plugins/people/store";
import { getCase } from "./store";

/**
 * Payments (the Cases plugin), by rule — no AI: the open todos that ask you to pay get a transfer action (the GiroCode a
 * click away) when the account is known — in the todo, or of a person it names or whose case it is; a case not summed up
 * yet pays to its person's account. Server only.
 */

/** A todo that asks for money to go out: to transfer, to pay, an instalment. */
const PAYS = /überweis|bezahl|zahl(?:en|ung)|\brate\b|raten|begleich|anweis/i;

/** The open todos that are payments get their transfer (those that have one keep it). How many got one. */
export function attachPayments(): number {
  if (!isInstalled("todos") || !isInstalled("people")) return 0;
  const people = payees();
  if (!people.length) return 0;
  let n = 0;
  for (const todo of listTodos({ status: "open" })) {
    if (!PAYS.test(todo.text) || todo.ops.some((o) => o.type === "bank-transfer")) continue;
    const p = paymentForTodo(todo, people);
    if (!p) continue;
    const op: TodoOp = { type: "bank-transfer", name: p.name, iban: p.iban, bic: p.bic ?? "", amount: p.amount != null ? p.amount.toFixed(2) : "", purpose: p.purpose };
    setTodoOps(todo.id, [...todo.ops, op], undefined, true);
    n++;
  }
  return n;
}

export type CasePayment = { name: string; iban: string; bic: string; purpose: string; amount: number | null };

/** Where a case pays to: what its summary says, else its person's account — the instalment (else what is open) as amount. */
export function casePayment(caseId: number): CasePayment | null {
  const c = getCase(caseId);
  if (!c) return null;
  const s = c.compiled;
  const amount = s?.installment ?? s?.open ?? null;
  if (s?.iban) return { name: s.payee || s.party || c.label, iban: s.iban, bic: s.bic, purpose: s.purpose || c.label, amount };
  if (!c.personId || !isInstalled("people")) return null;
  const p = getPerson(c.personId);
  if (!p) return null;
  const a = accountFor(p.name, detailsOf(p.id), claimsOf(p.id).map((x) => x.text));
  return a ? { name: a.name, iban: a.iban, bic: a.bic ?? "", purpose: s?.purpose || c.label, amount } : null;
}
