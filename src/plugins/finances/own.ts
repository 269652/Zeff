import { amountIn } from "@/lib/girocode";
import { emitChange } from "@/lib/events";
import { caseRefs } from "@/lib/boards/similar";
import { contactFor } from "@/plugins/cases/parties";
import { caseKey } from "@/plugins/cases/shared";
import { casesDb, listCases } from "@/plugins/cases/store";
import { openCommitments } from "@/plugins/people/graph";
import { isInstalled } from "@/plugins/state";
import { addRow, archivePage, getPage, rawRows, setCell } from "@/plugins/workspace/store";
import { DEBT } from "./fields";
import { debtsDbId } from "./debts";

/**
 * Your own debts and claims (the Finances plugin): rows of the debts database you write — what you owe someone (a loan from
 * Chris, a credit card), what someone owes you — taken from a promise too ("… 200 € zurücküberweisen"). Server only.
 */

type Kind = "person" | "organization";
export type Direction = "owe" | "owed";

export type DebtInput = {
  /** You owe it (default), or it is owed to you. */
  dir?: Direction;
  title: string;
  creditorId?: number | null;
  creditorName?: string;
  /** A new creditor: a person or an organisation (you say so). */
  creditorKind?: Kind;
  amount: number | null;
  due: string | null;
  installment: number | null;
  fromClaim?: number;
};

const money = (x: number | null | undefined) => (x != null && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null);

function debtsDb(): number {
  const id = debtsDbId();
  if (!id) throw new Error("The debts database isn't there (open the Workspace once).");
  return id;
}

/** A debt you write down: a row of your own in the debts database — its creditor (a contact, or a new one), its money as you said. Its row's id. */
export function createDebt(v: DebtInput): number {
  const title = v.title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) throw new Error("A title, please.");
  const creditor = v.creditorId ?? (v.creditorName ? contactFor(v.creditorName, true, v.creditorKind, true) : null);
  return addRow(debtsDb(), {
    title,
    cells: {
      [DEBT.dir]: v.dir === "owed" ? "owed" : "owe",
      ...(creditor ? { [DEBT.creditor]: [creditor] } : {}),
      [DEBT.total]: money(v.amount),
      [DEBT.open]: money(v.amount),
      [DEBT.rate]: money(v.installment),
      [DEBT.due]: v.due && /^\d{4}-\d{2}-\d{2}$/.test(v.due) ? v.due : null,
      ...(v.fromClaim ? { [DEBT.claim]: v.fromClaim } : {}),
    },
  });
}

/** A row of the debts database: yours to change only when it is your own (the cases' rows are what their letters say). */
function ownRow(rowId: number) {
  const row = getPage(rowId);
  if (!row?.dbId || row.dbId !== debtsDbId()) throw new Error("No such debt.");
  if (row.props.srcref) throw new Error("This debt is a case's — its figures are what its letters say.");
  return row;
}

/** A debt of your own changed: its money, its due day, the plan's day — emptied: gone. */
export function setDebtMoney(rowId: number, patch: { total?: number | null; open?: number | null; installment?: number | null; due?: string | null; day?: number | null }): void {
  ownRow(rowId);
  const fields: [keyof typeof patch, string][] = [["total", DEBT.total], ["open", DEBT.open], ["installment", DEBT.rate], ["due", DEBT.due], ["day", DEBT.day]];
  for (const [k, id] of fields) {
    if (patch[k] === undefined) continue;
    const v = patch[k];
    setCell(rowId, id, k === "due" ? (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null) : k === "day" ? (typeof v === "number" && v >= 1 && v <= 31 ? Math.round(v) : null) : money(v as number | null));
  }
}

/** A debt of your own removed (to the Workspace's bin — back from there). */
export function deleteDebt(rowId: number): void {
  ownRow(rowId);
  archivePage(rowId);
  emitChange("todos");
}

export type DebtSuggestion = { claimId: number; /** A promise of yours: you owe it; theirs: it is owed to you. */ dir: Direction; personId: number; name: string; text: string; amount: number; due: string | null };

/** Promises with an amount — yours ("… 200 € zurücküberweisen": a debt), theirs ("zahlt mir 50 € zurück": owed to you) — not written down yet. */
export function debtSuggestions(): DebtSuggestion[] {
  if (!isInstalled("people")) return [];
  const db = debtsDbId();
  const rows = db ? rawRows(db) : [];
  const taken = new Set(rows.flatMap((r) => (typeof r.cells[DEBT.claim] === "number" ? [r.cells[DEBT.claim] as number] : [])));
  const cases = listCases({ all: true });
  const keys = new Set(cases.map((c) => c.key));
  const running = cases.filter((c) => c.status === "open");
  const dirOf = (r: (typeof rows)[number]): Direction => (r.cells[DEBT.dir] === "owed" ? "owed" : "owe");
  const sideOf = (r: (typeof rows)[number]) => (Array.isArray(r.cells[DEBT.creditor]) ? (r.cells[DEBT.creditor] as number[]) : []);
  // Covered already — what they owe you: a row of that direction with them; what you owe: such a row, or a running case
  // with them (its person, creditor, collector, payee).
  const owedBy = new Set(rows.filter((r) => dirOf(r) === "owed").flatMap(sideOf));
  const covered = new Set<number>([
    ...rows.filter((r) => dirOf(r) === "owe").flatMap(sideOf),
    ...running.flatMap((c) => (c.personId ? [c.personId] : [])),
    ...(running.length ? (casesDb().prepare(`select person_id from case_parties where case_id in (${running.map(() => "?").join(",")})`).all(...running.map((c) => c.id)) as { person_id: number }[]).map((r) => r.person_id) : []),
  ]);
  return openCommitments()
    .filter((c) => !taken.has(c.id) && (c.direction === "mine" ? !covered.has(c.personId) && !caseRefs(c.text).some((r) => keys.has(caseKey(r))) : c.direction === "theirs" && !owedBy.has(c.personId)))
    .flatMap((c) => {
      const amount = amountIn(c.text);
      return amount ? [{ claimId: c.id, dir: (c.direction === "mine" ? "owe" : "owed") as Direction, personId: c.personId, name: c.personName, text: c.text, amount, due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : null }] : [];
    });
}

/** A promise of yours written down as a debt to that person. Its row's id. */
export function createDebtFromClaim(claimId: number): number {
  const s = debtSuggestions().find((x) => x.claimId === claimId);
  if (!s) throw new Error("This promise isn't open (or is a debt already).");
  return createDebt({ dir: s.dir, title: s.text, creditorId: s.personId, amount: s.amount, due: s.due, installment: null, fromClaim: s.claimId });
}
