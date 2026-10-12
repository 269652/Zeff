"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { findAllDates, findDates } from "./dates";
import { isDateKind, parseDayMonth } from "./shared";
import { addDate, addRelation, createPerson, deleteDate, deletePerson, deleteRelation, getPerson, markReminded, mergePeople, updateDate, updatePerson } from "./store";

/** The Personen plugin's server actions — forms post to them; each goes back to a page with what came of it. */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const back = (to: string, params: Record<string, string>): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`);

function guard(): void {
  if (!isInstalled("people")) throw new Error(t("The People plugin is not installed (Menu → Plugins)."));
}

/** A profile made (name; whatsapp, entity, aliases optional) — then its page. */
export async function createPersonFormAction(fd: FormData): Promise<void> {
  let id: number;
  try {
    guard();
    id = createPerson({ name: str(fd, "name"), whatsapp: str(fd, "whatsapp"), entityId: Number(str(fd, "entityId")) || null, aliases: list(str(fd, "aliases")) });
    // Its dates from the facts right away (no AI — that's a click on the profile).
    const { datesFromFacts } = await import("./dates");
    const p = getPerson(id);
    if (p) datesFromFacts(p);
  } catch (e) {
    back("/personen", { error: errorMessage(e) });
    return;
  }
  revalidatePath("/personen");
  if (fd.get("stay") === "1") back("/personen", { added: String(id) });
  redirect(`/personen/${id}`);
}

export async function updatePersonFormAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  try {
    guard();
    updatePerson(id, {
      name: fd.has("name") ? str(fd, "name") : undefined,
      aliases: fd.has("aliases") ? list(str(fd, "aliases")) : undefined,
      note: fd.has("note") ? String(fd.get("note") ?? "") : undefined,
      whatsapp: fd.has("whatsapp") ? str(fd, "whatsapp") : undefined,
      emails: fd.has("emails") ? list(str(fd, "emails")) : undefined,
      accounts: fd.has("jiraAccounts") ? list(str(fd, "jiraAccounts")).map((v) => ({ kind: "jira" as const, value: v.replace(/^[@~]/, "") })) : undefined,
      starred: fd.has("starred") ? fd.get("starred") === "1" : undefined,
    });
  } catch (e) {
    back(`/personen/${id}`, { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back(str(fd, "to") || `/personen/${id}`, { saved: "1" });
}

/** "Compile": the people's summaries, in the background — the page follows. */
export async function compileAllFormAction(fd: FormData): Promise<void> {
  let started = false;
  try {
    guard();
    const { startCompile } = await import("./compile");
    started = startCompile({ force: fd.get("force") === "1" });
  } catch (e) {
    back("/personen/compile", { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back("/personen/compile", started ? { started: "1" } : { busy: "1" });
}

/** "Compile" on one person: just that profile, again. */
export async function compileOneFormAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  let started = false;
  try {
    guard();
    const { startCompile } = await import("./compile");
    started = startCompile({ ids: [id], force: true });
  } catch (e) {
    back("/personen/compile", { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back("/personen/compile", started ? { started: "1" } : { busy: "1" });
}

/** "Import from context": the people of the last 14 days of your mails, chats, Teams, Jira and GitLab, through the AI — now. */
export async function importPeopleFormAction(): Promise<void> {
  let result = "";
  try {
    guard();
    const { importPeopleFromContext } = await import("./import");
    const r = await importPeopleFromContext();
    // Their Jira accounts, tied by name (no AI) — for the people just made too.
    await (await import("./accounts")).resolveJiraAccounts();
    result = `${r.created},${r.updated},${r.candidates}`;
  } catch (e) {
    back("/personen", { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back("/personen", { imported: result });
}

/** "Link Jira accounts": Jira users tied to profiles by their names (no AI) — now. */
export async function linkJiraAccountsFormAction(): Promise<void> {
  let n = 0;
  try {
    guard();
    // By the names seen on the tickets, and for the rest by asking Jira for the usernames their names would have.
    n = (await (await import("./accounts")).resolveJiraAccounts()).linked;
  } catch (e) {
    back("/personen", { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back("/personen", { linked: String(n) });
}

/** "Match names": the AI looks at who the names in your todos are — aliases, new profiles for contacts, duplicates merged — now (it also runs after each briefing). */
export async function normalizePeopleFormAction(): Promise<void> {
  let result = "";
  try {
    guard();
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const r = await (await import("./normalize")).normalizePeople();
    if (!r.ok) throw new Error(r.error ?? t("Failed."));
    result = `${r.aliases},${r.created},${r.merged},${r.relations}`;
  } catch (e) {
    back("/personen", { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back("/personen", { matched: result });
}

/** Two profiles that are one person: this one (`drop`) goes into the chosen one (`keep`) — its names become aliases, its chat, addresses, notes and dates come along. */
export async function mergePersonFormAction(fd: FormData): Promise<void> {
  const drop = Number(str(fd, "drop"));
  const keep = Number(str(fd, "keep"));
  try {
    guard();
    if (!keep || !drop || keep === drop) throw new Error(t("Pick the profile this one is the same person as."));
    mergePeople(keep, drop);
  } catch (e) {
    back(`/personen/${drop}`, { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back(`/personen/${keep}`, { saved: "1" });
}

/** A relation added by hand: what this person is (to you, or to the chosen profile). */
export async function addRelationFormAction(fd: FormData): Promise<void> {
  const personId = Number(str(fd, "personId"));
  try {
    guard();
    if (!addRelation(personId, str(fd, "rel"), Number(str(fd, "other")) || 0, "", "manual")) throw new Error(t("Enter what they are (e.g. mother, landlord) — it can't be saved twice."));
  } catch (e) {
    back(`/personen/${personId}`, { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back(`/personen/${personId}`, { saved: "1" });
}

export async function deleteRelationFormAction(fd: FormData): Promise<void> {
  guard();
  deleteRelation(Number(str(fd, "id")));
  revalidatePath("/personen", "layout");
  redirect(`/personen/${Number(str(fd, "personId"))}`);
}

export async function deletePersonFormAction(fd: FormData): Promise<void> {
  guard();
  deletePerson(Number(str(fd, "id")));
  revalidatePath("/personen", "layout");
  redirect("/personen");
}

/** A date added by hand: "16.10." or "16.10.1996" (yearly unless it's a one-off with its year). */
export async function addDateFormAction(fd: FormData): Promise<void> {
  const personId = Number(str(fd, "personId"));
  try {
    guard();
    const k = str(fd, "kind");
    const kind = isDateKind(k) ? k : "other";
    const date = parseDayMonth(str(fd, "date"));
    if (!date) throw new Error(t("A date like 16.10. or 16.10.1996, please."));
    const yearly = kind !== "other" || fd.get("yearly") === "1" || !date.year;
    addDate(personId, { kind, label: str(fd, "label"), ...date, yearly, remindDays: Number(str(fd, "remindDays")) || (kind === "birthday" ? 7 : 3), source: "manual" });
  } catch (e) {
    back(`/personen/${personId}`, { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  redirect(`/personen/${personId}`);
}

/** A date confirmed (a proposal), its reminder changed, or it removed. */
export async function dateFormAction(fd: FormData): Promise<void> {
  guard();
  const id = Number(str(fd, "id"));
  const op = str(fd, "op");
  if (op === "confirm") updateDate(id, { confirmed: true });
  else if (op === "remind") updateDate(id, { remindDays: Number(str(fd, "remindDays")) || 0 });
  else if (op === "delete") deleteDate(id);
  revalidatePath("/personen", "layout");
  redirect(str(fd, "to") || "/personen");
}

/** Dates for one person: facts and the AI — proposals to confirm. */
export async function findDatesFormAction(fd: FormData): Promise<void> {
  const personId = Number(str(fd, "personId"));
  let msg: Record<string, string>;
  try {
    guard();
    const r = await findDates(personId);
    msg = { found: String(r.facts + r.ai) };
  } catch (e) {
    msg = { error: errorMessage(e) };
  }
  revalidatePath("/personen", "layout");
  back(`/personen/${personId}`, msg);
}

/** Dates for everyone without a birthday yet — in the background. */
export async function findAllDatesFormAction(): Promise<void> {
  guard();
  findAllDates();
  revalidatePath("/personen");
  redirect("/personen?searching=1");
}

/** A reminder done (congratulated, thought of) — gone until next time. */
export async function remindedFormAction(fd: FormData): Promise<void> {
  guard();
  markReminded(Number(str(fd, "dateId")), str(fd, "on"));
  revalidatePath("/heute");
  revalidatePath("/personen", "layout");
  redirect(str(fd, "to") || "/heute");
}

/** What a person's hover card shows (a name in a todo): who they are, their next dates, facts, latest messages, open todos. */
export type PersonCardData = {
  id: number;
  name: string;
  aliases: string[];
  note: string;
  /** The compiled summary (the Compile page), if there is one. */
  summary: { connection: string; keyFacts: string[]; funFacts: string[]; at: string } | null;
  dates: { label: string; when: string }[];
  facts: { subject: string; text: string }[];
  /** "Mutter", "Tochter von Nadine", "Sohn: Max" — who they are to you / to others. */
  relations: string[];
  messages: { who: string; text: string; at: string; folder: string }[];
  todos: { id: number; ref: string; text: string }[];
};

/** A person's hover card's contents — loaded when it opens. Null: no such person (or the plugin is off). */
export async function personCardAction(id: number): Promise<PersonCardData | null> {
  if (!isInstalled("people")) return null;
  const p = getPerson(Number(id));
  if (!p) return null;
  const { contactsOf, datesOf, peopleIndex, relationsOf } = await import("./store");
  const { mentionMatcher, splitMentions } = await import("./mentions");
  // Named in a text the way todos show it (aliases, "Herr Kruger", "Nadines").
  const matcher = mentionMatcher(await peopleIndex());
  const names = (text: string) => splitMentions(text, matcher).some((m) => m.person?.id === p.id);
  const { dateText, daysBetween, inDaysText, isoDay, nextOccurrence, upcomingShort } = await import("./shared");
  const { listFacts } = await import("@/lib/facts");
  const { listTodos } = await import("@/lib/boards/store");
  const today = new Date();
  const dates = datesOf(p.id)
    .filter((d) => d.confirmed)
    .flatMap((d) => {
      const on = nextOccurrence(d, today);
      if (!on) return [];
      const inDays = daysBetween(today, on);
      const turns = d.year && d.yearly ? on.getFullYear() - d.year : null;
      return [{ inDays, label: upcomingShort({ date: d, person: p, on: isoDay(on), inDays, turns: turns && turns > 0 ? turns : null }, t), when: `${dateText(d)} · ${inDaysText(inDays, isoDay(on), t)}` }];
    })
    .sort((a, b) => a.inDays - b.inDays)
    .map(({ label, when }) => ({ label, when }));
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases,
    note: p.note.slice(0, 400),
    summary: p.compiled ? { connection: p.compiled.connection, keyFacts: p.compiled.keyFacts.slice(0, 5), funFacts: p.compiled.funFacts.slice(0, 4), at: p.compiled.at } : null,
    dates,
    facts: listFacts()
      .filter((f) => names(`${f.subject} ${f.text}`))
      .slice(0, 6)
      .map((f) => ({ subject: f.subject, text: f.text.slice(0, 200) })),
    relations: [
      ...relationsOf(p.id).out.map((r) => (r.otherId ? t("{rel} of {name}", { rel: r.rel, name: r.otherName ?? "?" }) : r.rel)),
      ...relationsOf(p.id).in.map((r) => `${r.personName}: ${r.rel}`),
    ].slice(0, 6),
    messages: contactsOf(p, 3).map((c) => ({ who: c.who, text: c.text.slice(0, 220), at: c.at, folder: c.folder })),
    todos: listTodos({ status: "open" })
      .filter((x) => names(x.text))
      .slice(0, 4)
      .map((x) => ({ id: x.id, ref: x.ref, text: x.text.slice(0, 140) })),
  };
}
