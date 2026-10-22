import { amountIn } from "@/lib/girocode";
import { emitChange } from "@/lib/events";
import { openCommitments } from "@/plugins/people/graph";
import { createPerson, listPeople, namesThem, setCircle, setKind } from "@/plugins/people/store";
import { isInstalled } from "@/plugins/state";
import type { CaseSummary } from "./shared";
import { caseRefs } from "@/lib/boards/similar";
import { caseKey } from "./shared";
import { casesDb, getCase, listCases, setOverrides, updateCase } from "./store";

/**
 * Who a case is with (the Cases plugin): its parties as contacts of the People plugin — the creditor (who it is owed to: a
 * bank, an authority, a company, a person), who collects it (a bailiff, a collection agency, a lawyer) and who is paid (whose
 * account). As the AI named them when it summed the case up — the contacts found by their names, or made (a person or an
 * organisation, as the AI said); what you chose stays. And debts of your own without a case number — to Chris, to the energy
 * company — written down by you or taken from a promise of yours. Server only.
 */

export const PARTY_ROLES = ["creditor", "collector", "payee"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export type PartySource = "ai" | "manual";
export type Party = { personId: number; name: string; source: PartySource };
type Kind = "person" | "organization";

const RANK: Record<PartySource, number> = { ai: 1, manual: 2 };

/** A case's parties, by role (a contact gone: none). */
export function partiesOf(caseId: number): Partial<Record<PartyRole, Party>> {
  const d = casesDb();
  const rows = d.prepare("select role, person_id, source from case_parties where case_id = ?").all(caseId) as { role: PartyRole; person_id: number; source: PartySource }[];
  const out: Partial<Record<PartyRole, Party>> = {};
  if (!rows.length || !isInstalled("people")) return out;
  for (const r of rows) {
    const p = d.prepare("select name from people where id = ?").get(r.person_id) as { name: string } | undefined;
    if (p) out[r.role] = { personId: r.person_id, name: p.name, source: r.source === "manual" ? "manual" : "ai" };
  }
  return out;
}

/** A party set (null: taken off). The AI's word doesn't go over yours. Whether it changed. */
export function setParty(caseId: number, role: PartyRole, personId: number | null, source: PartySource): boolean {
  const d = casesDb();
  const had = d.prepare("select person_id, source from case_parties where case_id = ? and role = ?").get(caseId, role) as { person_id: number; source: PartySource } | undefined;
  if (had && RANK[had.source] > RANK[source]) return false;
  if (personId == null) {
    if (!had) return false;
    d.prepare("delete from case_parties where case_id = ? and role = ?").run(caseId, role);
  } else {
    if (had?.person_id === personId && had.source === source) return false;
    d.prepare("insert into case_parties (case_id, role, person_id, source) values (?, ?, ?, ?) on conflict (case_id, role) do update set person_id = excluded.person_id, source = excluded.source").run(caseId, role, personId, source);
  }
  emitChange("todos");
  return true;
}

/**
 * The contact a name in a case means: one called so (or with that alias), else one whose name is in it — else, `make`, a new
 * one, a person or an organisation as the AI said (`kind`); a creditor that is an organisation in "authorities & creditors".
 */
function contactFor(name: string, make: boolean, kind?: Kind, creditor = false): number | null {
  const n = name.trim();
  if (!n || !isInstalled("people")) return null;
  const people = listPeople();
  const low = n.toLowerCase();
  const exact = people.find((p) => [p.name, ...p.aliases].some((x) => x.toLowerCase() === low));
  if (exact) return exact.id;
  // The longest name in it wins ("Gerichtsvollzieherin Nathanael, AG Freiburg" → the one with the alias "Nathanael").
  const named = people.filter((p) => namesThem(p, n)).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named.id;
  if (!make) return null;
  const id = createPerson({ name: n.slice(0, 120) });
  if (kind) setKind(id, kind, "ai");
  if (kind === "organization" && creditor) setCircle(id, "authorities", "ai");
  return id;
}

/** A case's parties as the AI named them in its summary — what you chose stays. A summary without them (older): none yet. */
export function assignParties(caseId: number): void {
  const c = getCase(caseId);
  const s = c?.compiled;
  if (!c || !s || s.manual || s.creditor === undefined) return;
  const creditor = s.creditor ? contactFor(s.creditor, true, s.creditorKind, true) : null;
  if (creditor) setParty(caseId, "creditor", creditor, "ai");
  // Who collects it: the one named — found, else the case's person (when not the creditor), else made.
  const collector = s.collector ? (contactFor(s.collector, false) ?? (c.personId && c.personId !== creditor ? c.personId : contactFor(s.collector, true, s.collectorKind))) : null;
  if (collector && collector !== creditor) setParty(caseId, "collector", collector, "ai");
  // Who is paid: the payee's contact (not made — an account holder isn't a contact of its own).
  const payee = s.payee ? contactFor(s.payee, false) : null;
  if (payee) setParty(caseId, "payee", payee, "ai");
}

/** Every running case's parties, as their summaries name them. */
export function assignAllParties(): void {
  for (const c of listCases()) if (c.status === "open" && c.compiled && !c.compiled.manual) assignParties(c.id);
}

// ---------------------------------------------------------------------------
// Debts of your own
// ---------------------------------------------------------------------------

export type DebtInput = {
  title: string;
  creditorId?: number | null;
  creditorName?: string;
  /** A new creditor: a person or an organisation (you say so). */
  creditorKind?: Kind;
  amount: number | null;
  due: string | null;
  installment: number | null;
  note?: string;
  fromClaim?: number;
};

const money = (x: number | null | undefined) => (x != null && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null);

/** A debt you write down (no case number): a case of its own ("MAN-12"), its creditor yours, its money as you said. Its id. */
export function createDebt(v: DebtInput): number {
  const title = v.title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) throw new Error("A title, please.");
  const creditor = v.creditorId ?? (v.creditorName ? contactFor(v.creditorName, true, v.creditorKind, true) : null);
  const d = casesDb();
  const at = new Date().toISOString();
  const r = d.prepare("insert into cases (key, label, person_id, note, created_at, updated_at, last_at) values (?, ?, ?, ?, ?, ?, ?)").run(`MAN-new-${at}-${Math.random()}`, title, creditor, (v.note ?? "").slice(0, 20000), at, at, at);
  const id = Number(r.lastInsertRowid);
  d.prepare("update cases set key = ? where id = ?").run(`MAN-${id}`, id);
  let party = v.creditorName ?? "";
  if (!party && creditor) party = (d.prepare("select name from people where id = ?").get(creditor) as { name: string } | undefined)?.name ?? "";
  const summary: CaseSummary = {
    title,
    party,
    summary: "",
    total: money(v.amount),
    open: money(v.amount),
    installment: money(v.installment),
    nextDue: v.due && /^\d{4}-\d{2}-\d{2}$/.test(v.due) ? v.due : null,
    nextWhat: "",
    iban: "",
    bic: "",
    payee: "",
    purpose: title,
    done: false,
    at,
    sources: 0,
    manual: true,
    ...(v.fromClaim ? { fromClaim: v.fromClaim } : {}),
  };
  updateCase(id, { compiled: summary });
  if (creditor) setParty(id, "creditor", creditor, "manual");
  return id;
}

/** A case's money corrected by you (total, open, instalment, due) — it stays over what the AI sums up later; null takes it back. */
export function editCaseMoney(caseId: number, patch: { total?: number | null; open?: number | null; installment?: number | null; due?: string | null }): void {
  if (!getCase(caseId)) throw new Error("Unknown case.");
  const value = (x: number | null | undefined) => (x === undefined ? undefined : x === null ? null : (money(x) ?? null));
  setOverrides(caseId, {
    ...(patch.total !== undefined ? { total: value(patch.total) } : {}),
    ...(patch.open !== undefined ? { open: value(patch.open) } : {}),
    ...(patch.installment !== undefined ? { installment: value(patch.installment) } : {}),
    ...(patch.due !== undefined ? { nextDue: patch.due && /^\d{4}-\d{2}-\d{2}$/.test(patch.due) ? patch.due : null } : {}),
  });
}

/**
 * A debt's money changed on the overview: a debt of your own takes it as it is (emptied: gone); one from letters keeps your
 * correction over the AI's (emptied: the AI's again).
 */
export function setDebtMoney(caseId: number, patch: { total?: number | null; open?: number | null; installment?: number | null; due?: string | null }): void {
  const c = getCase(caseId);
  if (!c) throw new Error("Unknown case.");
  if (!c.compiled?.manual) return editCaseMoney(caseId, patch);
  // Yours: the values themselves (a correction kept from before goes, so it can't cover them).
  setOverrides(caseId, { total: null, open: null, installment: null, nextDue: null });
  updateDebt(caseId, patch);
}

/** A debt of your own removed (with its parties) — a case from letters isn't removed so (set it aside instead). */
export function deleteDebt(caseId: number): void {
  const c = getCase(caseId);
  if (!c) return;
  if (!c.compiled?.manual) throw new Error("Only a debt of your own is removed so — set a case from letters aside.");
  casesDb().prepare("delete from cases where id = ?").run(caseId);
  emitChange("todos");
}

/** A debt of your own changed (its money, its due day, its title). */
export function updateDebt(caseId: number, patch: { title?: string; total?: number | null; open?: number | null; installment?: number | null; due?: string | null }): void {
  const c = getCase(caseId);
  if (!c?.compiled?.manual) throw new Error("Only a debt you wrote down yourself is changed so.");
  const s = { ...c.compiled };
  if (patch.title !== undefined && patch.title.trim()) s.title = patch.title.trim().slice(0, 120);
  if (patch.total !== undefined) s.total = money(patch.total);
  if (patch.open !== undefined) s.open = money(patch.open);
  if (patch.installment !== undefined) s.installment = money(patch.installment);
  if (patch.due !== undefined) s.nextDue = patch.due && /^\d{4}-\d{2}-\d{2}$/.test(patch.due) ? patch.due : null;
  updateCase(caseId, { compiled: s, ...(patch.title?.trim() ? { label: s.title } : {}) });
}

export type DebtSuggestion = { claimId: number; personId: number; name: string; text: string; amount: number; due: string | null };

/** Your promises with an amount (a commitment of yours: "… 200 € zurücküberweisen") not written down as a debt yet. */
export function debtSuggestions(): DebtSuggestion[] {
  if (!isInstalled("people")) return [];
  const cases = listCases({ all: true });
  const taken = new Set(cases.flatMap((c) => (c.compiled?.fromClaim ? [c.compiled.fromClaim] : [])));
  // A case already: its number in the promise, or the promise's person on a running case (its creditor, collector, payee).
  const keys = new Set(cases.map((c) => c.key));
  const running = cases.filter((c) => c.status === "open");
  const onCase = new Set<number>([...running.flatMap((c) => (c.personId ? [c.personId] : [])), ...(running.length ? (casesDb().prepare(`select person_id from case_parties where case_id in (${running.map(() => "?").join(",")})`).all(...running.map((c) => c.id)) as { person_id: number }[]).map((r) => r.person_id) : [])]);
  return openCommitments()
    .filter((c) => c.direction === "mine" && !taken.has(c.id) && !onCase.has(c.personId) && !caseRefs(c.text).some((r) => keys.has(caseKey(r))))
    .flatMap((c) => {
      const amount = amountIn(c.text);
      return amount ? [{ claimId: c.id, personId: c.personId, name: c.personName, text: c.text, amount, due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : null }] : [];
    });
}

/** A promise of yours written down as a debt to that person. Its case's id. */
export function createDebtFromClaim(claimId: number): number {
  const s = debtSuggestions().find((x) => x.claimId === claimId);
  if (!s) throw new Error("This promise isn't open (or is a debt already).");
  return createDebt({ title: s.text, creditorId: s.personId, amount: s.amount, due: s.due, installment: null, fromClaim: s.claimId });
}
