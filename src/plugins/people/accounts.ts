import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { BoardTicket } from "@/lib/boards/shared";
import { addAccount, listPeople } from "./store";
import type { Person } from "./shared";

/**
 * Linked accounts of people (the People plugin): who is which Jira user — so a note that tags
 * someone (@Name) becomes a mention of the same person in Jira ([~username]). Server only.
 */

/** "Name (username)" as the briefing run lists everyone on a ticket. */
const LISTED = /^(.+?) \(([^()]+)\)$/;

/**
 * The Jira users Zeff has seen — display name (lower case) → username — from the people the
 * latest briefing runs list on their tickets. A name two usernames go by isn't in it: not guessed.
 */
export function jiraDirectory(): Map<string, string> {
  return new Map([...jiraUsers()].map(([name, u]) => [name, u.user] as [string, string]));
}

/** The same with the name as Jira writes it: display name (lower case) → { name, username }. */
export function jiraUsers(): Map<string, { name: string; user: string }> {
  const seen = new Map<string, Set<string>>();
  const shown = new Map<string, string>();
  for (const run of getDb().select({ tickets: schema.boardRuns.tickets }).from(schema.boardRuns).where(eq(schema.boardRuns.status, "ok")).orderBy(desc(schema.boardRuns.id)).limit(12).all()) {
    let tickets: BoardTicket[] = [];
    try {
      tickets = JSON.parse(run.tickets) as BoardTicket[];
    } catch {
      continue;
    }
    for (const t of tickets) {
      for (const p of t.people ?? []) {
        const m = LISTED.exec(p.trim());
        if (!m) continue;
        const name = m[1].trim().toLowerCase();
        if (!shown.has(name)) shown.set(name, m[1].trim());
        seen.set(name, (seen.get(name) ?? new Set()).add(m[2].trim()));
      }
    }
  }
  return new Map([...seen].flatMap(([name, users]) => (users.size === 1 ? [[name, { name: shown.get(name) ?? name, user: [...users][0] }] as [string, { name: string; user: string }]] : [])));
}

/**
 * Tie Jira usernames to people by name: a profile whose name or alias is a Jira user's display name
 * (exactly, whole) gets that user as a linked account — unless it's unclear (two users of that name,
 * a user another profile has already, or several different users for one profile). How many were linked.
 */
export function linkJiraAccounts(): number {
  const directory = jiraDirectory();
  const people = listPeople();
  const taken = new Set(people.flatMap((p) => p.accounts.filter((a) => a.kind === "jira").map((a) => a.value.toLowerCase())));
  let linked = 0;
  for (const p of people) {
    if (p.accounts.some((a) => a.kind === "jira")) continue;
    const users = new Set([p.name, ...p.aliases].map((n) => directory.get(n.trim().toLowerCase())).filter((u): u is string => !!u));
    if (users.size !== 1) continue;
    const [user] = users;
    if (taken.has(user.toLowerCase())) continue;
    if (addAccount(p.id, "jira", user)) {
      taken.add(user.toLowerCase());
      linked++;
    }
  }
  return linked;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Everything someone is tagged by: their name, aliases and Jira usernames — a form two people share names neither. */
function tagForms(people: Person[]): Map<string, Person> {
  const count = new Map<string, number>();
  const own = people.map((p) => ({ p, forms: [...new Set([p.name, ...p.aliases, ...p.accounts.map((a) => a.value)].map((f) => f.trim().toLowerCase()).filter((f) => f.length >= 2))] }));
  for (const { forms } of own) for (const f of forms) count.set(f, (count.get(f) ?? 0) + 1);
  const out = new Map<string, Person>();
  for (const { p, forms } of own) for (const f of forms) if (count.get(f) === 1) out.set(f, p);
  return out;
}

/**
 * A note's words for Jira: each @-tagged person (@Christopher Lorenz, @Chris, @chrlorenz1) becomes
 * their Jira mention ([~username]); one without a Jira account stays as plain words (reported in
 * `noAccount`). Names without an @ are left alone.
 */
export function mentionsToJira(text: string, people: Person[] = listPeople()): { text: string; mentioned: string[]; noAccount: string[] } {
  const forms = tagForms(people);
  const mentioned = new Set<string>();
  const noAccount = new Set<string>();
  if (!forms.size) return { text, mentioned: [], noAccount: [] };
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}_.@])@(${[...forms.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\p{L}\p{N}_])`, "giu");
  const out = text.replace(re, (_all, form: string) => {
    const person = forms.get(form.toLowerCase())!;
    const jira = person.accounts.find((a) => a.kind === "jira");
    if (!jira) {
      noAccount.add(person.name);
      return form;
    }
    mentioned.add(jira.value);
    return `[~${jira.value}]`;
  });
  return { text: out, mentioned: [...mentioned], noAccount: [...noAccount] };
}
