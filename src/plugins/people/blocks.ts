import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { claimsOf, linksOf, reviewClaim, reviewLink } from "./graph";
import { findDates } from "./dates";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { addDetail, detailsOf, isDetailKey, removeDetail, syncDetails, type PersonDetail } from "./details";
import { compilePerson } from "./compile";
import { dateKindLabels, dateText, daysBetween, inDaysText, isDateKind, isoDay, nextOccurrence, parseDayMonth, type DateKind, type PersonSummary } from "./shared";
import { addDate, addRelation, contactsOf, datesOf, deleteDate, deletePerson, deleteRelation, getPerson, listPeople, mergePeople, namesThem, relationsOf, updateDate, updatePerson, type Contact, type PersonRelation } from "./store";

/**
 * What the blocks of a person's page show and do — the detail view of a row of the people database (profile, dates, summary,
 * what is known, relations, messages, todos, pages, tickets). They work on the profile the row stands for.
 */

/** The profile a row stands for (its source reference "person:<id>"); null: not one of a person. */
export function personOfRow(rowId: number, depth = 0): number | null {
  const row = getSqlite().prepare("select props from ws_pages where id = ?").get(rowId) as { props: string } | undefined;
  if (!row || depth > 6) return null;
  try {
    const ref = String((JSON.parse(row.props) as Record<string, unknown>).srcref ?? "");
    const m = /^person:(\d+)$/.exec(ref);
    if (m) return getPerson(Number(m[1])) ? Number(m[1]) : null;
    // A row of a database made from the people database (a filter of it): it stands for the row it was made from.
    const from = /^page:(\d+)$/.exec(ref);
    return from ? personOfRow(Number(from[1]), depth + 1) : null;
  } catch {
    return null;
  }
}

export type PersonBundle = {
  id: number;
  name: string;
  aliases: string[];
  emails: string[];
  jira: string[];
  whatsapp: string;
  note: string;
  starred: boolean;
  compiled: PersonSummary | null;
  dates: { id: number; kind: DateKind; label: string; text: string; confirmed: boolean; remindDays: number; sourceText: string; when: string | null; turns: number | null }[];
  /** Bank account, addresses, phone, office hours — read off the claims, or yours. */
  details: PersonDetail[];
  claims: { id: number; kind: string; text: string; status: string; evidence: string; confidence: number; due: string; done: boolean; source: string }[];
  links: { id: number; rel: string; targetType: string; targetRef: string; label: string; status: string }[];
  relations: { out: PersonRelation[]; in: (PersonRelation & { personName: string })[] };
  contacts: Contact[];
  todos: { id: number; ref: string; text: string; due: string | null }[];
  pages: { id: number; title: string; icon: string }[];
  tickets: string[];
  others: { id: number; name: string }[];
  /** Their letters: documents with their address in them, or naming them — the newest first. */
  documents: { id: number; name: string; summary: string; at: string }[];
  /** Their cases (the Cases plugin): the money and the next step at a glance. */
  cases: { id: number; label: string; title: string; open: number | null; nextDue: string | null; done: boolean; href: string }[];
};

/** The documents that are theirs: their address in the text, or their name in the title, summary or text. */
function documentsOf(p: NonNullable<ReturnType<typeof getPerson>>): PersonBundle["documents"] {
  let rows: { id: number; name: string; summary: string; text: string; at: string }[] = [];
  try {
    rows = getSqlite().prepare("select id, name, summary, substr(text, 1, 6000) text, created_at at from documents where status = 'ready' order by created_at desc").all() as typeof rows;
  } catch {
    return []; // the Documents plugin never ran
  }
  const emails = p.emails.map((e) => e.toLowerCase());
  // Their name as people write it — a last name alone too, when it is no one else's ("U. Nathanael").
  const matcher = mentionMatcher(buildPeopleIndex(listPeople()));
  const named = (text: string) => splitMentions(text, matcher).some((m) => m.person?.id === p.id);
  return rows
    .filter((d) => emails.some((e) => d.text.toLowerCase().includes(e)) || namesThem(p, `${d.name} ${d.summary}`) || named(`${d.name} ${d.summary} ${d.text}`))
    .slice(0, 30)
    .map((d) => ({ id: d.id, name: d.name, summary: d.summary, at: d.at }));
}

async function casesOfPerson(personId: number): Promise<PersonBundle["cases"]> {
  if (!isInstalled("cases")) return [];
  const { casesOfPerson: ofPerson } = await import("@/plugins/cases/store");
  const { caseHref } = await import("@/plugins/cases/database");
  const { caseTitle } = await import("@/plugins/cases/shared");
  return Promise.all(ofPerson(personId).map(async (c) => ({ id: c.id, label: c.label, title: caseTitle(c), open: c.compiled?.open ?? null, nextDue: c.compiled?.nextDue ?? null, done: c.status === "closed" || !!c.compiled?.done, href: await caseHref(c.id) })));
}

export async function personBundle(personId: number, today = new Date()): Promise<PersonBundle> {
  const p = getPerson(personId);
  if (!p) throw new Error(t("Unknown person."));
  const label = dateKindLabels(t);
  syncDetails(personId);
  const links = linksOf(personId);
  let todos: PersonBundle["todos"] = [];
  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    todos = listTodos({ status: "open" })
      .filter((todo) => namesThem(p, `${todo.text} ${todo.note ?? ""}`))
      .slice(0, 15)
      .map((todo) => ({ id: todo.id, ref: todo.ref, text: todo.text, due: todo.due }));
  }
  const pages = isInstalled("workspace") ? (await import("@/plugins/workspace/store")).pagesMentioning("person", personId, 20).map((x) => ({ id: x.id, title: x.title || t("Untitled"), icon: x.icon || (x.kind === "database" ? "🗂️" : "📄") })) : [];
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases,
    emails: p.emails,
    jira: p.accounts.filter((a) => a.kind === "jira").map((a) => a.value),
    whatsapp: p.whatsapp,
    note: p.note,
    starred: p.starred,
    compiled: p.compiled,
    dates: datesOf(personId).map((d) => {
      const on = nextOccurrence(d, today);
      return {
        id: d.id,
        kind: d.kind,
        label: d.kind === "other" ? d.label || label.other : label[d.kind],
        text: dateText(d),
        confirmed: d.confirmed,
        remindDays: d.remindDays,
        sourceText: d.sourceText,
        when: on ? inDaysText(daysBetween(today, on), isoDay(on), t) : null,
        turns: on && d.year && d.yearly && d.kind === "birthday" ? on.getFullYear() - d.year : null,
      };
    }),
    details: detailsOf(personId),
    claims: claimsOf(personId).map((c) => ({ id: c.id, kind: c.kind, text: c.text, status: c.status, evidence: c.evidence, confidence: c.confidence, due: c.due, done: !!c.doneAt, source: c.sourceRef })),
    links: links.map((l) => ({ id: l.id, rel: l.rel, targetType: l.targetType, targetRef: l.targetRef, label: l.label, status: l.status })),
    relations: relationsOf(personId),
    contacts: contactsOf(p, 12),
    todos,
    pages,
    tickets: [...new Set(links.filter((l) => l.targetType === "ticket").map((l) => l.targetRef))],
    others: listPeople().filter((x) => x.id !== personId).map((x) => ({ id: x.id, name: x.name })),
    documents: documentsOf(p),
    cases: await casesOfPerson(personId),
  };
}

const list = (v: unknown) => String(v ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

export type PersonOperation =
  | { op: "profile"; name?: string; aliases?: string; emails?: string; whatsapp?: string; jira?: string }
  | { op: "note"; note: string }
  | { op: "star"; on: boolean }
  | { op: "addDate"; kind: string; date: string; label: string }
  | { op: "dateConfirm" | "dateDelete"; id: number }
  | { op: "dateRemind"; id: number; days: number }
  | { op: "findDates" }
  | { op: "compile" }
  | { op: "review"; what: "claim" | "link"; id: number; action: "confirm" | "reject" | "done" | "recheck" }
  | { op: "detail"; action: "add" | "remove"; key: string; value: string }
  | { op: "addRelation"; rel: string; other: number }
  | { op: "deleteRelation"; id: number }
  | { op: "merge"; keep: number }
  | { op: "delete" };

/** An operation of the blocks on a profile. `gone`: the profile is no more (merged, deleted) — the page goes. */
export async function personOp(personId: number, o: PersonOperation): Promise<{ gone?: boolean; keep?: number; message?: string }> {
  if (!getPerson(personId)) throw new Error(t("Unknown person."));
  switch (o.op) {
    case "profile":
      updatePerson(personId, {
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.aliases !== undefined ? { aliases: list(o.aliases) } : {}),
        ...(o.emails !== undefined ? { emails: list(o.emails) } : {}),
        ...(o.whatsapp !== undefined ? { whatsapp: o.whatsapp } : {}),
        ...(o.jira !== undefined ? { accounts: list(o.jira).map((v) => ({ kind: "jira" as const, value: v.replace(/^[@~]/, "") })) } : {}),
      });
      return {};
    case "note":
      updatePerson(personId, { note: String(o.note ?? "") });
      return {};
    case "star":
      updatePerson(personId, { starred: !!o.on });
      return {};
    case "addDate": {
      const kind = isDateKind(o.kind) ? o.kind : "other";
      const date = parseDayMonth(String(o.date ?? ""));
      if (!date) throw new Error(t("A date like 16.10. or 16.10.1996, please."));
      addDate(personId, { kind, label: String(o.label ?? "").trim(), ...date, yearly: kind !== "other" || !date.year, remindDays: kind === "birthday" ? 7 : 3, source: "manual" });
      return {};
    }
    case "dateConfirm":
      updateDate(Number(o.id), { confirmed: true });
      return {};
    case "dateDelete":
      deleteDate(Number(o.id));
      return {};
    case "dateRemind":
      updateDate(Number(o.id), { remindDays: Math.max(0, Math.min(60, Number(o.days) || 0)) });
      return {};
    case "findDates": {
      const r = await findDates(personId);
      return { message: r.facts + r.ai ? t("{n} dates found — confirm below.", { n: r.facts + r.ai }) : t("No new dates found.") };
    }
    case "compile": {
      if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
      const r = await compilePerson(personId, { force: true });
      return { message: r.state === "nothing-known" ? t("Zeff knows nothing of them yet.") : t("Summary compiled.") };
    }
    case "review":
      if (o.what === "link") reviewLink(Number(o.id), o.action === "confirm" ? "confirm" : "reject");
      else if (o.action === "confirm" || o.action === "reject" || o.action === "done" || o.action === "recheck") reviewClaim(Number(o.id), o.action);
      return {};
    case "detail":
      if (!isDetailKey(String(o.key))) throw new Error(t("Unknown detail."));
      if (o.action === "remove") removeDetail(personId, o.key as PersonDetail["key"], String(o.value ?? ""));
      else addDetail(personId, o.key as PersonDetail["key"], String(o.value ?? ""));
      return {};
    case "addRelation":
      if (!addRelation(personId, String(o.rel ?? ""), Number(o.other) || 0, "", "manual")) throw new Error(t("Enter what they are (e.g. mother, landlord) — it can't be saved twice."));
      return {};
    case "deleteRelation":
      deleteRelation(Number(o.id));
      return {};
    case "merge":
      mergePeople(Number(o.keep), personId);
      return { gone: true, keep: Number(o.keep) };
    case "delete":
      deletePerson(personId);
      return { gone: true };
  }
}
