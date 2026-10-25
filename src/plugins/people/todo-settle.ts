import { euroAmounts, refDue, refLabeler, todoAmount, todoAmounts, todoLinkFinder, todoSettler, type Evidence } from "@/lib/boards/todo-settle";
import { getSqlite } from "@/db";
import { allocate, deallocate, onLedgerChange, paidOn, paymentByKey, recordPayment } from "@/lib/money/ledger";
import { isInstalled } from "@/plugins/state";
import { detailsOf } from "./details";
import { onRunUndone } from "@/lib/boards/run-undo";
import { claimById, claimsFrom, claimsOf, dropRunClaims, openCommitments, reviewClaim, type Claim } from "./graph";
import { listPeople, namesThem } from "./store";

/**
 * What hangs on a proof, for the People plugin (lib/boards/todo-settle.ts): a promise of yours to pay. From a todo: one made where the
 * todo comes from (a chat message, a mail: "I'll give you the 40 € back on Friday"). From a booking no todo took (the fallback): one
 * to whoever the booking paid — by name or account — of the amount it paid. Only a promise of an amount it pays: one message often
 * holds several (another sum, a plan of instalments, a call), and those stay open. Server only.
 */

/** A plan of instalments: kept by many payments, not by one. */
const PLAN = /\braten(?:plan)?\b|monatlich|\bà\s*\d|je(?:weils)?\s+\d+\s*€/i;

/** The amount of a promise the proof pays — null: it names none the proof pays (or it is a plan). */
export function promisedAmount(c: Pick<Claim, "text">, paid: number[]): number | null {
  if (PLAN.test(c.text)) return null;
  return euroAmounts(c.text).find((a) => paid.some((p) => Math.abs(p - a) < 0.005)) ?? null;
}

const open = (c: Claim) => c.kind === "commitment" && c.direction === "mine" && !c.doneAt && c.status !== "rejected";
const iban = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** The people a booking paid: by the account it went to, else by name in what the booking says. */
export function peoplePaid(e: Pick<Evidence, "payee" | "text">): number[] {
  if (!e.payee) return [];
  const to = iban(e.payee.iban);
  const said = `${e.payee.name} ${e.text}`;
  const byAccount = to ? listPeople().filter((p) => detailsOf(p.id).some((d) => d.key === "iban" && iban(d.value) === to)) : [];
  return (byAccount.length ? byAccount : listPeople().filter((p) => namesThem(p, said))).map((p) => p.id);
}

todoLinkFinder((e) => {
  if (!isInstalled("people")) return [];
  const paid = todoAmounts(e);
  if (!paid.length) return [];
  const fromSources = e.refs.flatMap((ref) => claimsFrom(ref).filter((c) => open(c) && promisedAmount(c, paid) != null));
  // A booking (no sources): the promises to whoever it paid.
  const fromPayee = e.payee ? peoplePaid(e).flatMap((id) => claimsOf(id).filter((c) => open(c) && promisedAmount(c, paid) != null)) : [];
  return [...fromSources, ...fromPayee].map((c) => `claim:${c.id}`);
});

// ---------------------------------------------------------------------------
// A promise to pay, kept by the ledger: done while what is allocated to it is what it promised — computed, never set
// ---------------------------------------------------------------------------

/** The promises the ledger closed (not you by hand): only these does it open again when their payment goes. */
function keptTable() {
  const d = getSqlite();
  d.exec("create table if not exists people_claims_kept (claim_id integer primary key, at text not null)");
  return d;
}

/** A promise brought to the ledger: what it promised paid — done; no longer (its payment released, its todo opened again) — open again, when the ledger had closed it. */
export function recomputeClaim(claimId: number): void {
  const c = claimById(claimId);
  if (!c || c.kind !== "commitment") return;
  const promised = euroAmounts(c.text)[0];
  if (promised == null) return;
  const kept = paidOn(`claim:${claimId}`) >= promised - 0.005;
  const d = keptTable();
  const byLedger = !!d.prepare("select 1 from people_claims_kept where claim_id = ?").get(claimId);
  if (kept && !c.doneAt) {
    reviewClaim(claimId, "done");
    d.prepare("insert or replace into people_claims_kept (claim_id, at) values (?, ?)").run(claimId, new Date().toISOString());
  } else if (!kept && c.doneAt && byLedger) {
    reviewClaim(claimId, "reopen");
    d.prepare("delete from people_claims_kept where claim_id = ?").run(claimId);
  }
}

onLedgerChange("claim", (ref) => recomputeClaim(Number(ref.slice(6))));

todoSettler(
  "claim",
  (ref, e) => {
    const c = claimById(Number(ref.slice(6)));
    const amount = c ? promisedAmount(c, todoAmounts(e)) : null;
    if (!c || amount == null) return false;
    // The proof's payment (the same one a debt it pays gets — one payment, for what it pays) allocated to the promise: kept.
    const source = e.key.startsWith("todo:") ? "todo" : e.key.startsWith("tx:") ? "bank" : "hand";
    const p = recordPayment({ key: e.key, date: e.date, amount: todoAmount(e) ?? amount, label: e.label, source, tx: source === "bank" ? e.key.slice(3) : null });
    allocate(p.id, ref, amount);
    return true;
  },
  // The proof taken back: its allocation released — the promise as the ledger says without it.
  (ref, _undo, key) => {
    const p = paymentByKey(key);
    if (p) deallocate(p.id, ref);
  },
);

// A promise's day (by Friday) is the due day of its todo when nothing else gives one.
refDue("claim", { dueOf: (ref) => openCommitments().find((c) => c.id === Number(ref.slice(6)))?.due || null });

refLabeler("claim", (ref) => {
  const c = claimById(Number(ref.slice(6)));
  return c ? { title: `${c.personName}: ${c.text}`, href: null } : null;
});

// A Lage run taken back: the promises and facts read in it that you haven't looked at go with its todos.
onRunUndone((runId) => (isInstalled("people") ? dropRunClaims(runId) : 0));
