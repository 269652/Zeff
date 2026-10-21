/**
 * Cases (Vorgänge): what a case number (Aktenzeichen) holds together — the mails, letters, todos and
 * appointments about one matter, the person on the other side, what is owed and when. Client-safe.
 */

/** open: running · closed: done (comes back when something new arrives) · ignored: not a case (never made again). */
export type CaseStatus = "open" | "closed" | "ignored";
export const CASE_STATUSES: CaseStatus[] = ["open", "closed", "ignored"];

/** What the AI made of a case's sources (compile.ts): the matter in a line, the money, the next step. */
export type CaseSummary = {
  title: string;
  /** Who it is for or against: the creditor, the authority, the company. */
  party: string;
  summary: string;
  /** The whole claim, the part still open, a running instalment — in euro; null: not said. */
  total: number | null;
  open: number | null;
  installment: number | null;
  /** The next payment or deadline (YYYY-MM-DD) and what it is. */
  nextDue: string | null;
  nextWhat: string;
  /** Where to pay: account, recipient, purpose (the case number when nothing else is said). */
  iban: string;
  bic: string;
  payee: string;
  purpose: string;
  /** What the AI thinks: running or done. */
  done: boolean;
  /** Who it is owed to and who collects it (a bailiff, a collection agency), as the AI named them — the contacts are the case's parties. */
  creditor?: string;
  creditorKind?: "person" | "organization";
  collector?: string;
  collectorKind?: "person" | "organization";
  /** A debt you wrote down yourself (no case number): kept as you wrote it — never summed up by the AI. */
  manual?: boolean;
  /** Made from a promise of yours (a claim of the People plugin). */
  fromClaim?: number;
  at: string;
  sources: number;
};

export type Case = {
  id: number;
  /** The case number as compared: "DR II 1121/26" (a court's department number before it dropped). */
  key: string;
  /** As it was written last ("11 DR II 1121/26"). */
  label: string;
  status: CaseStatus;
  /** The profile on the other side (People), when known. */
  personId: number | null;
  note: string;
  compiled: CaseSummary | null;
  createdAt: string;
  updatedAt: string;
  /** When its newest source is from. */
  lastAt: string;
};

export type CaseSource = { ref: string; kind: "mail" | "doc" | "todo" | "event"; at: string; title: string };

/** A case number as compared: upper case, single spaces, the department number in front ("11 DR II …") dropped. */
export const caseKey = (ref: string): string =>
  ref
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/^\d{1,2} (?=[A-ZÄÖÜ])/, "");

/** The title shown: the AI's, else the case number. */
export const caseTitle = (c: Pick<Case, "label" | "compiled">): string => c.compiled?.title || c.label;
