import { caseRefs } from "@/lib/boards/similar";
import type { TodoView } from "@/lib/boards/shared";
import { accountFor, amountIn, bicIn, ibansIn, recipientIn, sameIban, type Account } from "@/lib/girocode";

/**
 * A todo that is a payment ("Restforderung 24,80 € (Az. DR II 456/26) … überweisen") as a GiroCode: who gets it
 * — an IBAN in its text or your notes, the bank account of a person it names or whose case number it carries,
 * one the knowledge it was given names — the first amount in its text, and its case number as the purpose
 * (else its text). Pure: the people come in as payees (see payees() in the People plugin).
 */

/** Someone a todo may pay: their details (iban, bic, bank), what was said about them, whether a text names them. */
export type Payee = { name: string; details: { key: string; value: string }[]; texts: string[]; names: (text: string) => boolean };

/** A todo's payment: the account, the amount (if it names one), the purpose, and whose account it is ("": the todo's own text). */
export type TodoPayment = Account & { amount?: number; purpose: string; via: string };

type TodoLike = Pick<TodoView, "text" | "note" | "userNotes" | "knowledge">;

export function paymentForTodo(todo: TodoLike, payees: Payee[] = []): TodoPayment | null {
  const own = [todo.text, todo.note ?? "", ...(todo.userNotes ?? []).map((n) => n.text)].filter(Boolean);
  const all = own.join("\n");
  const refs = caseRefs(all);
  const theirs = (p: Payee) => p.names(all) || (refs.length > 0 && p.texts.some((t) => caseRefs(t).some((r) => refs.includes(r))));
  const entities = (todo.knowledge?.entities ?? []).map((e) => ({ name: e.name, text: [e.summary, ...e.related.map((r) => r.fact)].join("\n") }));
  const account = ((): (Account & { via: string }) | null => {
    // An IBAN in the todo itself: the recipient named beside it, else whose account it is.
    for (const text of own) {
      const iban = ibansIn(text)[0];
      if (!iban) continue;
      const bic = bicIn(text);
      const holder = payees.find((p) => p.details.some((d) => d.key === "iban" && sameIban(d.value, iban))) ?? payees.find(theirs);
      const name = recipientIn(text) ?? (holder && accountFor(holder.name, holder.details, holder.texts)?.name) ?? entities.find((e) => ibansIn(e.text).some((x) => sameIban(x, iban)))?.name;
      if (name) return { name, iban, ...(bic ? { bic } : {}), via: "" };
    }
    // A person it names, or whose case it is.
    for (const p of payees.filter(theirs)) {
      const a = accountFor(p.name, p.details, p.texts);
      if (a) return { ...a, via: p.name };
    }
    // The knowledge it was given.
    for (const e of entities) {
      const iban = ibansIn(e.text)[0];
      if (!iban) continue;
      const bic = bicIn(e.text);
      return { name: recipientIn(e.text) ?? e.name, iban, ...(bic ? { bic } : {}), via: e.name };
    }
    return null;
  })();
  if (!account) return null;
  const amount = amountIn(todo.text);
  const purpose = caseRefs(todo.text)[0] ?? refs[0] ?? todo.text.replace(/\s+/g, " ").trim().slice(0, 140);
  const { via, ...rest } = account;
  return { ...rest, ...(amount != null ? { amount } : {}), purpose, via };
}
