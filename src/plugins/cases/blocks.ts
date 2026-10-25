import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { TodoSource, TodoView } from "@/lib/boards/shared";
import { compileCases } from "./compile";
import { detectCases } from "./detect";
import { casePayment, type CasePayment } from "./payments";
import { caseStanding, paymentsOf } from "./bank";
import { CASE_STATUSES, caseTitle, type CaseStatus, type CaseSummary } from "./shared";
import { getCase, setCaseStatus, sourcesOf, updateCase } from "./store";

/** What a case's page shows and does — the custom view of a row of the cases database. Server only. */

export type CaseBundle = {
  id: number;
  key: string;
  label: string;
  title: string;
  status: CaseStatus;
  note: string;
  compiled: CaseSummary | null;
  person: { id: number; name: string; href: string } | null;
  people: { id: number; name: string; kind: "person" | "organization" }[];
  /** Who it is owed to, who collects it, who is paid — contacts, with their pages; `source` manual: chosen by you. */
  parties: Partial<Record<import("./parties").PartyRole, { personId: number; name: string; href: string; source: "ai" | "manual" }>>;
  /** A debt you wrote down yourself: its money is yours to change. */
  manual: boolean;
  /** Its mails, letters, appointments — as a todo's sources are shown. */
  sources: TodoSource[];
  todos: { id: number; ref: string; text: string; done: boolean; due: string | null }[];
  counts: { mail: number; doc: number; todo: number };
  canCompile: boolean;
  /** Where it pays to: its summary's account, else its person's. */
  payment: CasePayment | null;
  /** Being summed up now (the first time it is opened). */
  compiling: boolean;
  /** The payments the bank shows for it, and what is open after those since its summary. */
  /** The payments: the bank's bookings, and those of payment todos ticked off (`todo`: its ref). */
  paid: { date: string; amount: number; todo: string | null }[];
  openNow: number | null;
};

export async function caseBundle(caseId: number): Promise<CaseBundle> {
  const c = getCase(caseId);
  if (!c) throw new Error(t("Unknown case."));
  // Never summed up: now, in the background — the page shows it once it is done.
  const compiling = !c.compiled && c.status === "open" && isInstalled("llm");
  if (compiling) void compileCases({ ids: [caseId] }).catch(() => {});
  const all = sourcesOf(caseId);
  const refs = all.filter((s) => s.kind !== "todo").map((s) => s.ref);
  let sources: TodoSource[] = [];
  if (refs.length) {
    const { todoSources } = await import("@/lib/boards/sources");
    const found = todoSources([{ refs } as unknown as TodoView], []);
    sources = refs.map((r) => found[r]).filter((s): s is TodoSource => !!s);
  }
  const todoIds = all.filter((s) => s.kind === "todo").map((s) => Number(s.ref.slice(5)));
  const todos = todoIds.length
    ? (getSqlite().prepare(`select id, text, status, due from todos where id in (${todoIds.map(() => "?").join(",")}) and merged_into is null order by status = 'done', id desc`).all(...todoIds) as { id: number; text: string; status: string; due: string | null }[]).map((x) => ({ id: x.id, ref: `T-${x.id}`, text: x.text, done: x.status === "done", due: x.due }))
    : [];
  let person: CaseBundle["person"] = null;
  let people: CaseBundle["people"] = [];
  if (isInstalled("people")) {
    const { listPeople, getPerson } = await import("@/plugins/people/store");
    people = listPeople().map((p) => ({ id: p.id, name: p.name, kind: p.kind }));
    const p = c.personId ? getPerson(c.personId) : null;
    if (p) person = { id: p.id, name: p.name, href: isInstalled("workspace") ? (await import("@/plugins/workspace/people-database")).personHref(p.id) : "/personen" };
  }
  const { partiesOf } = await import("./parties");
  const hrefOf = async (id: number) => (isInstalled("workspace") ? (await import("@/plugins/workspace/people-database")).personHref(id) : "/personen");
  const parties: CaseBundle["parties"] = {};
  for (const [role, p] of Object.entries(partiesOf(caseId))) if (p) parties[role as keyof CaseBundle["parties"]] = { ...p, href: await hrefOf(p.personId) };
  return {
    id: c.id,
    key: c.key,
    parties,
    manual: !!c.compiled?.manual,
    label: c.label,
    title: caseTitle(c),
    status: c.status,
    note: c.note,
    compiled: c.compiled,
    person,
    people,
    sources,
    todos,
    counts: { mail: all.filter((s) => s.kind === "mail").length, doc: all.filter((s) => s.kind === "doc").length, todo: todos.length },
    canCompile: isInstalled("llm"),
    payment: casePayment(caseId),
    compiling,
    paid: paymentsOf(caseId).map((p) => ({ date: p.date, amount: p.amount, todo: p.txId.startsWith("todo:") ? `T-${p.txId.slice(5)}` : null })),
    openNow: caseStanding(caseId).open,
  };
}

export type CaseOperation =
  | { op: "status"; status: string }
  | { op: "note"; note: string }
  | { op: "person"; personId: number | null }
  | { op: "compile" }
  | { op: "refresh" }
  /** A party chosen by you (null: none) — or a new contact by its name, a person or an organisation. */
  | { op: "party"; role: string; personId: number | null }
  | { op: "newParty"; role: string; name: string; kind: "person" | "organization" }

export async function caseOp(caseId: number, o: CaseOperation): Promise<{ message?: string }> {
  if (!getCase(caseId)) throw new Error(t("Unknown case."));
  switch (o.op) {
    case "status":
      if (!(CASE_STATUSES as string[]).includes(o.status)) throw new Error(t("Unknown status."));
      setCaseStatus(caseId, o.status as CaseStatus);
      return {};
    case "note":
      updateCase(caseId, { note: String(o.note ?? "") });
      return {};
    case "person":
      updateCase(caseId, { personId: o.personId ? Number(o.personId) : null });
      return {};
    case "party":
    case "newParty": {
      const { PARTY_ROLES, setParty } = await import("./parties");
      if (!(PARTY_ROLES as readonly string[]).includes(o.role)) throw new Error(t("Unknown role."));
      const role = o.role as (typeof PARTY_ROLES)[number];
      let id = o.op === "party" ? (o.personId ? Number(o.personId) : null) : null;
      if (o.op === "newParty") {
        const { createPerson, setKind, setCircle } = await import("@/plugins/people/store");
        if (!String(o.name ?? "").trim()) throw new Error(t("A name, please."));
        id = createPerson({ name: String(o.name) });
        setKind(id, o.kind === "organization" ? "organization" : "person", "manual");
        if (role === "creditor" && o.kind === "organization") setCircle(id, "authorities", "ai");
      }
      setParty(caseId, role, id, "manual");
      // The case's person follows its creditor when it had none.
      if (role === "creditor" && id && !getCase(caseId)?.personId) updateCase(caseId, { personId: id });
      return {};
    }
    case "refresh": {
      const r = detectCases();
      return { message: t("{c} new cases, {l} new sources", { c: r.created, l: r.linked }) };
    }
    case "compile": {
      if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
      const r = await compileCases({ ids: [caseId], force: true });
      if (r.error) throw new Error(r.error);
      return { message: t("Case summed up.") };
    }
  }
}
