import { euroAmounts, todoAmounts, todoLinkFinder, todoSettler } from "@/lib/boards/todo-settle";
import { isInstalled } from "@/plugins/state";
import { claimsFrom, reviewClaim, type Claim } from "./graph";

/**
 * What hangs on a todo, for the People plugin (lib/boards/todo-settle.ts): a promise of yours to pay, made where the todo comes from
 * (a chat message, a mail: "I'll give you the 40 € back on Friday") — the todo done, the promise is kept. Only a promise of an amount
 * the todo pays: one message often holds several (another sum, a plan of instalments, a call), and those stay open. Server only.
 */

/** A plan of instalments: kept by many payments, not by one. */
const PLAN = /\braten(?:plan)?\b|monatlich|\bà\s*\d|je(?:weils)?\s+\d+\s*€/i;

/** The amount of a promise the todo pays — null: it names none the todo pays (or it is a plan). */
export function promisedAmount(c: Pick<Claim, "text">, paid: number[]): number | null {
  if (PLAN.test(c.text)) return null;
  return euroAmounts(c.text).find((a) => paid.some((p) => Math.abs(p - a) < 0.005)) ?? null;
}

todoLinkFinder((todo) => {
  if (!isInstalled("people")) return [];
  const paid = todoAmounts(todo);
  if (!paid.length) return [];
  return todo.refs.flatMap((ref) =>
    claimsFrom(ref)
      .filter((c) => c.kind === "commitment" && c.direction === "mine" && !c.doneAt && c.status !== "rejected" && promisedAmount(c, paid) != null)
      .map((c) => `claim:${c.id}`),
  );
});

todoSettler(
  "claim",
  (ref) => {
    reviewClaim(Number(ref.slice(6)), "done");
    return true;
  },
  // The todo opened again: the promise open again.
  (ref) => reviewClaim(Number(ref.slice(6)), "reopen"),
);
