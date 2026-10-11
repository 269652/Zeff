"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { findAllDates, findDates } from "./dates";
import { isDateKind, parseDayMonth } from "./shared";
import { addDate, createPerson, deleteDate, deletePerson, getPerson, markReminded, updateDate, updatePerson } from "./store";

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
      starred: fd.has("starred") ? fd.get("starred") === "1" : undefined,
    });
  } catch (e) {
    back(`/personen/${id}`, { error: errorMessage(e) });
  }
  revalidatePath("/personen", "layout");
  back(str(fd, "to") || `/personen/${id}`, { saved: "1" });
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
  dates: { label: string; when: string }[];
  facts: { subject: string; text: string }[];
  messages: { who: string; text: string; at: string; folder: string }[];
  todos: { id: number; ref: string; text: string }[];
};

/** A person's hover card's contents — loaded when it opens. Null: no such person (or the plugin is off). */
export async function personCardAction(id: number): Promise<PersonCardData | null> {
  if (!isInstalled("people")) return null;
  const p = getPerson(Number(id));
  if (!p) return null;
  const { contactsOf, datesOf, peopleIndex } = await import("./store");
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
    dates,
    facts: listFacts()
      .filter((f) => names(`${f.subject} ${f.text}`))
      .slice(0, 6)
      .map((f) => ({ subject: f.subject, text: f.text.slice(0, 200) })),
    messages: contactsOf(p, 3).map((c) => ({ who: c.who, text: c.text.slice(0, 220), at: c.at, folder: c.folder })),
    todos: listTodos({ status: "open" })
      .filter((x) => names(x.text))
      .slice(0, 4)
      .map((x) => ({ id: x.id, ref: x.ref, text: x.text.slice(0, 140) })),
  };
}
