import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { findAllProgress } from "./dates";
import { compileProgress, startCompile } from "./compile";
import { acceptSuggestion, pendingSuggestions, rejectSuggestion, type Suggestion } from "./identity";
import { openCommitments, proposedClaims, proposedLinks, reviewClaim, reviewLink, staleClaims, type Link } from "./graph";
import { addManualTodo } from "@/lib/todos/store";
import { personCardExtras } from "./card";
import { detailsOf } from "./details";
import { acceptConfident, lastContactsAll, meetingBriefs, myName, nudgeWeeks, nudges, setMyName, setNudgeWeeks, snoozeNudge, type LastContact, type MeetingBrief, type Nudge } from "./pulse";
import { greetingDraft } from "./greeting";
import { dateKindLabels, dateText, inDaysText, isCircle, upcomingTitle, type Circle, type Person } from "./shared";
import { createPerson, deleteDate, getPerson, listPeople, namesThem, proposedDates, setCircle, updateDate, upcoming, whatsappChats } from "./store";
import { localDay } from "@/lib/dates";

/**
 * The tools of the people database's overview (its "People" view): what to look at (dates coming up, names that may be one
 * person, what the AI read and wants confirmed, dates found), what to run (import from context, find dates, match names, read
 * messages, link Jira accounts, compile summaries) and who to take over (from the knowledge and WhatsApp).
 */

export type PeopleOverview = {
  count: number;
  upcoming: { key: string; personId: number; title: string; when: string; soon: boolean }[];
  identities: { id: number; text: string; evidence: string; confidence: number }[];
  dates: { id: number; personId: number; person: string; text: string; source: string }[];
  claims: { id: number; personId: number; person: string; kind: string; text: string; evidence: string; confidence: number }[];
  links: { id: number; personId: number; person: string; text: string; evidence: string }[];
  stale: { id: number; personId: number; person: string; text: string }[];
  owed: { id: number; personId: number; person: string; text: string; direction: string; due: string }[];
  suggestions: { persons: { id: number; name: string; aliases: string[]; pages: number }[]; chats: { name: string; messages: number }[]; error: string | null };
  progress: { dates: { done: number; total: number; found: number } | null; compile: { done: number; total: number; current?: string } | null };
  /** Per person (by id): what their card shows beyond the row — last contact, circle, role, what is open, how to reach or pay them. */
  cards: Record<number, PersonCardInfo>;
  /** Who you care about and haven't been in touch with for a while. */
  nudges: Nudge[];
  /** Appointments with someone in the next 24 hours, a brief each. */
  meetings: MeetingBrief[];
  /** How many proposed claims and links the AI is sure of (90 % and more) — to take at once. */
  confident: number;
  /** `aboutMe`: what you wrote about yourself (lib/about-me.ts — the same record as Settings → About me). */
  settings: { weeks: number; myName: string; aboutMe: string };
};

export type PersonCardInfo = {
  lastContact: LastContact | null;
  circle: Circle | "";
  circleSource: Person["circleSource"];
  role: string | null;
  owed: { id: number; direction: "mine" | "theirs"; text: string; due: string }[];
  away: string | null;
  email: string;
  chat: string;
  /** Their account, to pay them (a GiroCode). */
  pay: { iban: string; bic: string } | null;
  /** Their birthday is today (0) or tomorrow (1) — a greeting to draft. */
  birthdayIn: number | null;
  /** Money between you (the Finances plugin's debts and claims): what you owe them, what they owe you. */
  debt: { owe: number; owed: number } | null;
  /** Their unread messages (chats, mail from them) — shown first on the card. */
  unread?: number;
};

/** What an identity suggestion proposes, in words (`nameOf`: a profile's name by its id). */
export function suggestionText(s: Suggestion, nameOf: (id: number) => string | undefined): string {
  const target = nameOf(s.personId) ?? "?";
  const other = nameOf(s.otherId ?? 0) ?? s.name;
  if (s.kind === "merge") return t("Merge {other} into {name}", { other, name: target });
  return s.kind === "alias" ? t("“{alias}” is another name of {name}", { alias: s.name, name: target }) : t("New profile for {name}", { name: s.name });
}

/** A link without its person: "works-with Sarah Klein", "on-ticket PC-1", "works-at Acme" (an organisation or place by its name). */
export const linkText = (l: Pick<Link, "rel" | "targetType" | "targetRef"> & { label?: string }, who: (id: number) => string) =>
  `${l.rel} ${l.targetType === "person" ? who(Number(l.targetRef)) : (l.targetType === "org" || l.targetType === "place") && l.label ? l.label : l.targetRef}`;

export async function peopleOverview(): Promise<PeopleOverview> {
  const people = listPeople();
  const byId = new Map(people.map((p) => [p.id, p]));
  const who = (id: number) => byId.get(id)?.name ?? "?";
  const taken = new Set(people.flatMap((p) => [p.name, ...p.aliases, p.whatsapp].filter(Boolean).map((n) => n.toLowerCase())));
  const suggestions: PeopleOverview["suggestions"] = { persons: [], chats: whatsappChats().filter((c) => !taken.has(c.name.toLowerCase())).slice(0, 16).map((c) => ({ name: c.name, messages: c.messages })), error: null };
  if (isInstalled("knowledge")) {
    try {
      const { knowledgePersons } = await import("@/plugins/knowledge/client");
      suggestions.persons = (await knowledgePersons()).filter((p) => p.pages >= 2 && ![p.name, ...p.aliases].some((n) => taken.has(n.toLowerCase()))).slice(0, 24).map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, pages: p.pages }));
    } catch (e) {
      suggestions.error = errorMessage(e);
    }
  }
  const compile = compileProgress();
  const contacts = await lastContactsAll(people);
  const today = localDay();
  const owedAll = openCommitments();
  // Money between you and each (with the Finances plugin): what you owe them, what they owe you.
  const debts = isInstalled("finances") ? (await import("@/plugins/finances/debts")).balances() : new Map<number, { owe: number; owed: number }>();
  const birthdays = new Map(upcoming({ days: 1 }).filter((u) => u.date.kind === "birthday").map((u) => [u.person.id, u.inDays]));
  const unread = (await import("./badges")).unreadByPerson(people);
  const cards: PeopleOverview["cards"] = {};
  for (const p of people) {
    const x = personCardExtras(p.id, today);
    const details = detailsOf(p.id);
    const iban = details.find((d) => d.key === "iban")?.value ?? "";
    cards[p.id] = {
      lastContact: contacts.get(p.id) ?? null,
      circle: p.circle,
      circleSource: p.circleSource,
      role: x.role,
      owed: owedAll.filter((c) => c.personId === p.id && (c.direction === "mine" || c.direction === "theirs")).map((c) => ({ id: c.id, direction: c.direction as "mine" | "theirs", text: c.text, due: c.due })),
      away: x.away?.until ?? null,
      email: p.emails[0] ?? "",
      chat: p.whatsapp,
      pay: iban ? { iban, bic: details.find((d) => d.key === "bic")?.value ?? "" } : null,
      birthdayIn: birthdays.get(p.id) ?? null,
      debt: debts.get(p.id) ?? null,
      unread: unread.get(p.id) ?? 0,
    };
  }
  return {
    cards,
    nudges: nudges({ contacts }),
    meetings: await meetingBriefs().catch(() => []),
    confident: proposedClaims().filter((c) => c.confidence >= 0.9).length + proposedLinks().filter((l) => l.confidence >= 0.9).length,
    settings: { weeks: nudgeWeeks(), myName: myName(), aboutMe: (await import("@/lib/about-me")).aboutMe() },
    count: people.length,
    upcoming: upcoming({ days: 60 })
      .slice(0, 12)
      .map((u) => ({ key: String(u.date.id), personId: u.person.id, title: upcomingTitle(u, t), when: inDaysText(u.inDays, u.on, t), soon: u.inDays <= u.date.remindDays })),
    identities: pendingSuggestions()
      .slice(0, 30)
      .map((s) => ({ id: s.id, text: suggestionText(s, (id) => byId.get(id)?.name), evidence: s.evidence, confidence: s.confidence })),
    dates: proposedDates().map((d) => ({ id: d.id, personId: d.personId, person: d.personName, text: `${d.kind === "other" ? d.label || t("Date") : dateKindLabels(t)[d.kind]}: ${dateText(d)}`, source: d.sourceText })),
    claims: proposedClaims()
      .filter((c) => c.kind !== "commitment" || !c.doneAt)
      .map((c) => ({ id: c.id, personId: c.personId, person: c.personName, kind: c.kind, text: c.text, evidence: c.evidence, confidence: c.confidence })),
    links: proposedLinks().map((l) => ({ id: l.id, personId: l.personId, person: l.personName, text: linkText(l, who), evidence: l.evidence })),
    stale: staleClaims().map((c) => ({ id: c.id, personId: c.personId, person: c.personName, text: c.text })),
    owed: openCommitments().map((c) => ({ id: c.id, personId: c.personId, person: c.personName, text: c.text, direction: c.direction, due: c.due })),
    suggestions,
    progress: { dates: findAllProgress(), compile: compile && !compile.result ? { done: compile.done, total: compile.total, current: compile.current } : null },
  };
}

export type PeopleTool =
  | { tool: "add"; name: string; whatsapp?: string; entityId?: number; aliases?: string[] }
  | { tool: "import" | "findAll" | "normalize" | "linkJira" }
  | { tool: "extract"; days?: number }
  | { tool: "compile"; force?: boolean }
  | { tool: "suggestion"; id: number; accept: boolean }
  | { tool: "dateConfirm" | "dateDelete"; id: number }
  | { tool: "claim" | "link"; id: number; action: "confirm" | "reject" | "done" | "recheck" }
  | { tool: "circle"; id: number; circle: Circle | "" }
  | { tool: "snooze"; id: number; days?: number }
  | { tool: "acceptConfident" }
  | { tool: "settings"; weeks?: number; myName?: string; aboutMe?: string }
  | { tool: "todo"; id: number; text: string }
  | { tool: "greeting"; id: number }
  | { tool: "classify"; force?: boolean };

/** A tool of the overview; what came of it, in words. */
export async function peopleTool(o: PeopleTool): Promise<{ message?: string; draft?: string }> {
  switch (o.tool) {
    case "circle":
      if (o.circle && !isCircle(o.circle)) throw new Error(t("Unknown circle."));
      setCircle(Number(o.id), o.circle, "manual");
      return {};
    case "snooze":
      snoozeNudge(Number(o.id), Math.max(1, Math.min(365, Number(o.days) || 14)));
      return {};
    case "acceptConfident": {
      const r = acceptConfident(0.9);
      return { message: t("{c} claims and {l} links taken", { c: r.claims, l: r.links }) };
    }
    case "settings":
      if (o.weeks !== undefined) setNudgeWeeks(Number(o.weeks));
      if (o.myName !== undefined) setMyName(String(o.myName));
      // About you: the one record (Settings → About me, the AI settings, its prompt page show the same).
      if (o.aboutMe !== undefined) await (await import("@/lib/about-me")).setAboutMe(String(o.aboutMe));
      return { message: t("Saved.") };
    case "todo": {
      const p = getPerson(Number(o.id));
      if (!p || !String(o.text ?? "").trim()) throw new Error(t("A text, please."));
      const text = String(o.text).trim();
      // The todo names them, so it shows on their page and card.
      addManualTodo({ ticket: "", text: namesThem(p, text) ? text : `${text} (${p.name})` });
      return { message: t("Todo added ✓") };
    }
    case "greeting":
      return { draft: await greetingDraft(Number(o.id)) };
    case "classify": {
      if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
      const r = await (await import("./classify")).classifyContacts({ force: !!o.force, myName: myName() || undefined });
      return { message: r.asked ? t("{n} contacts placed — {c} changes", { n: r.asked, c: r.changed }) : t("Every contact is placed already.") };
    }
    case "add": {
      const id = createPerson({ name: String(o.name ?? ""), whatsapp: o.whatsapp, entityId: o.entityId ?? null, aliases: o.aliases });
      // Its dates from the facts right away (no AI — that is a click on the profile).
      const { datesFromFacts } = await import("./dates");
      const p = getPerson(id);
      if (p) datesFromFacts(p);
      return { message: t("Added ✓") };
    }
    case "import": {
      const r = await (await import("./import")).importPeopleFromContext();
      await (await import("./accounts")).resolveJiraAccounts();
      return { message: t("{c} new people, {u} updated — from {k} contacts of the last 14 days", { c: r.created, u: r.updated, k: r.candidates }) };
    }
    case "linkJira": {
      const n = (await (await import("./accounts")).resolveJiraAccounts()).linked;
      return { message: n === 0 ? t("No new Jira accounts found.") : t("{n} Jira accounts linked.", { n }) };
    }
    case "normalize": {
      if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
      const r = await (await import("./normalize")).normalizePeople();
      if (!r.ok) throw new Error(r.error ?? t("Failed."));
      return { message: t("{a} aliases, {c} new, {m} merged, {r} relations", { a: r.aliases, c: r.created, m: r.merged, r: r.relations }) };
    }
    case "extract": {
      if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
      const days = Math.max(0, Math.min(90, Number(o.days) || 0));
      const r = await (await import("./extract")).extractKnowledge({ sinceDays: days || undefined });
      if (!r.ok) throw new Error(r.error ?? t("Failed."));
      return { message: t("{i} messages read — {c} claims, {l} links", { i: r.items, c: r.claims, l: r.links + r.derived }) };
    }
    case "findAll":
      await (await import("@/lib/host/commands")).findAllDatesAnywhere();
      return { message: t("Searching dates …") };
    case "compile":
      return { message: startCompile({ force: !!o.force }) ? t("Started — the summaries appear as they are done.") : t("A compile run is going already.") };
    case "suggestion":
      // (Through the proposals' decide(): the accepted profile's past messages are read again there.)
      if (o.accept) await acceptSuggestion(Number(o.id));
      else await rejectSuggestion(Number(o.id));
      return {};
    case "dateConfirm":
      updateDate(Number(o.id), { confirmed: true });
      return {};
    case "dateDelete":
      deleteDate(Number(o.id));
      return {};
    case "claim":
      if (o.action === "confirm" || o.action === "reject" || o.action === "done" || o.action === "recheck") reviewClaim(Number(o.id), o.action);
      return {};
    case "link":
      reviewLink(Number(o.id), o.action === "confirm" ? "confirm" : "reject");
      return {};
  }
}
