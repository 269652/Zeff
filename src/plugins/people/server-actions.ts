"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { linksOf, visibleClaims } from "./graph";
import { getPerson, markReminded } from "./store";

/** The Personen plugin's server actions — what todos' names (hover cards, tag suggestions) and Today's reminders call. The people's page itself is the Workspace's (see blocks.ts). */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function guard(): void {
  if (!isInstalled("people")) throw new Error(t("The People plugin is not installed (Menu → Plugins)."));
}

/** Who to tag in a note on this todo: the people linked to its ticket and to what the note is about — not those already tagged. */
export async function suggestTagsAction(todoId: number, text: string): Promise<{ id: number; name: string; why: string }[]> {
  if (!isInstalled("people")) return [];
  const { getTodo } = await import("@/lib/boards/store");
  const { whoKnows } = await import("./graph");
  const { splitTags, mentionMatcher } = await import("./mentions");
  const { peopleIndex } = await import("./store");
  const todo = getTodo(Number(todoId));
  if (!todo) return [];
  const tagged = new Set(splitTags(text, mentionMatcher(await peopleIndex())).flatMap((m) => (m.person ? [m.person.id] : [])));
  return whoKnows(`${todo.text} ${text}`, { ticket: todo.ticket ?? undefined, limit: 6 })
    .filter((e) => !tagged.has(e.personId))
    .map((e) => ({ id: e.personId, name: e.name, why: e.why.slice(0, 3).join(" · ") }));
}

/** A reminder done (congratulated, thought of) — gone until next time. */
export async function remindedFormAction(fd: FormData): Promise<void> {
  guard();
  markReminded(Number(str(fd, "dateId")), str(fd, "on"));
  revalidatePath("/heute");
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
  /** What was read from messages: roles, responsibilities, facts (confirmed, or the AI's sure ones). */
  claims: { kind: string; text: string; confirmed: boolean }[];
  /** What they are linked to: tickets, topics, people — "is on PROJ-364", "manages Rico Clemen". */
  links: string[];
  /** Open commitments with them: who owes what, by when. */
  owed: { direction: "mine" | "theirs"; text: string; due: string }[];
  /** What they do (a role read about them, a confirmed one first). */
  role: string | null;
  /** Phone, address, IBAN — one each. */
  details: { key: string; value: string }[];
  /** A claim says they are away until this day ("YYYY-MM-DD", not passed yet). */
  away: { until: string; text: string } | null;
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
  const { personCardExtras } = await import("./card");
  const extras = personCardExtras(p.id, isoDay(today));
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
    claims: visibleClaims(p.id)
      .filter((c) => c.kind !== "commitment" && c.text !== extras.role && c.text !== extras.away?.text)
      .slice(0, 5)
      .map((c) => ({ kind: c.kind, text: c.text, confirmed: c.status === "confirmed" })),
    links: linksOf(p.id)
      .filter((l) => l.rel !== "commented-on")
      .slice(0, 6)
      .map((l) => `${l.rel.replace(/-/g, " ")} ${l.targetType === "person" ? (getPerson(Number(l.targetRef))?.name ?? "?") : l.targetRef}`),
    owed: extras.owed,
    role: extras.role,
    details: extras.details,
    away: extras.away,
    messages: contactsOf(p, 3).map((c) => ({ who: c.who, text: c.text.slice(0, 220), at: c.at, folder: c.folder })),
    todos: listTodos({ status: "open" })
      .filter((x) => names(x.text))
      .slice(0, 4)
      .map((x) => ({ id: x.id, ref: x.ref, text: x.text.slice(0, 140) })),
  };
}
