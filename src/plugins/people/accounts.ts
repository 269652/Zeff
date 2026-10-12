import { createHash } from "node:crypto";
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

/** A name as people write it, for comparing: lower case, umlauts as ue/oe/ae/ss, accents gone, titles gone, "Last, First" as "First Last". */
export function normalizeName(s: string): string {
  let v = s.trim();
  if (v.includes(",")) {
    const [a, b] = v.split(",").map((x) => x.trim());
    v = `${b} ${a}`;
  }
  v = v
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(dr|prof|herr|frau|mr|mrs|ms)\.?\s+/g, "");
  return v.replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim();
}

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
};

/** Whether two names are the same person's as written: the same once normalized, or — for names of 8 letters and more — a letter (12 and more: two) off. */
export function nameSimilar(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.split(" ").length !== y.split(" ").length) return false;
  const shortest = Math.min(x.length, y.length);
  return distance(x, y) <= (shortest >= 12 ? 2 : shortest >= 8 ? 1 : 0);
}

/**
 * The Jira usernames a person of this name probably has: here they are the first three letters of the first name
 * and the first five of the last (Jonas Teichrueb → jonteich), with a digit when there are two of them (…1, …2).
 * In the order to try them. A single name gives none.
 */
export function usernameCandidates(name: string): string[] {
  const words = normalizeName(name).split(" ").filter(Boolean);
  if (words.length < 2) return [];
  const letters = (w: string) => w.replace(/[^a-z0-9]/g, "");
  const base = letters(words[0]).slice(0, 3) + letters(words[words.length - 1]).slice(0, 5);
  return base.length >= 4 ? [base, `${base}1`, `${base}2`, `${base}3`] : [];
}

/** Which Jira user is meant by these names: the one whose name is the same once normalized, else the one it's near — each only when unambiguous. */
function findUser(names: string[], users: Map<string, { name: string; user: string }>): string | null {
  const list = [...users.values()];
  const exact = new Set(list.filter((u) => names.some((n) => normalizeName(n) === normalizeName(u.name))).map((u) => u.user));
  if (exact.size) return exact.size === 1 ? [...exact][0] : null;
  const near = new Set(list.filter((u) => names.some((n) => nameSimilar(n, u.name))).map((u) => u.user));
  return near.size === 1 ? [...near][0] : null;
}

/**
 * Tie Jira usernames to people by name: a profile whose name or alias is a Jira user's display name (as
 * Jira's users are listed on the tickets — written differently, umlauts, a letter off, "Last, First" all fit)
 * gets that user as a linked account — unless it's unclear (two users that fit, a user another profile has
 * already). How many were linked.
 */
export function linkJiraAccounts(): number {
  const users = jiraUsers();
  const people = listPeople();
  const taken = new Set(people.flatMap((p) => p.accounts.filter((a) => a.kind === "jira").map((a) => a.value.toLowerCase())));
  let linked = 0;
  for (const p of people) {
    if (p.accounts.some((a) => a.kind === "jira")) continue;
    const user = findUser([p.name, ...p.aliases], users);
    if (!user || taken.has(user.toLowerCase())) continue;
    if (addAccount(p.id, "jira", user)) {
      taken.add(user.toLowerCase());
      linked++;
    }
  }
  return linked;
}

/** One Jira user as Jira knows them: the username and the name it shows. */
export type JiraProfile = { username: string; displayName: string };
export type JiraLookup = (username: string) => Promise<JiraProfile | null>;

/** Jira's user lookup through its MCP server (one session for the whole run): null for a user that isn't there. */
async function withJiraLookup<T>(fn: (lookup: JiraLookup) => Promise<T>): Promise<T> {
  const { getJiraSyncConfig } = await import("@/lib/jira/sync");
  const { resultToPayload, runStdioSession } = await import("@/lib/jira/mcp-client");
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new Error("Jira isn't set up.");
  let out!: T;
  await runStdioSession(
    { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
    async (call) => {
      out = await fn(async (username) => {
        try {
          let p = resultToPayload(await call("jira_get_user_profile", { user_identifier: username })) as unknown;
          if (typeof p === "string") p = JSON.parse(p);
          const o = (p && typeof p === "object" ? ((p as { user?: unknown }).user ?? p) : {}) as Record<string, unknown>;
          const displayName = String(o.display_name ?? o.displayName ?? "").trim();
          return displayName ? { username: String(o.name ?? o.key ?? username), displayName } : null;
        } catch {
          return null; // not there (or not readable): not that user
        }
      });
    },
    120000,
  );
  return out;
}

/**
 * Tie Jira users to people as far as it can be done: by the names Zeff has seen on the tickets (linkJiraAccounts), and
 * for everyone without an account (`ids`: only those) by asking Jira about the usernames their name would have
 * (see usernameCandidates) — a user is taken when the name Jira shows for it is the person's. `lookup` is Jira's user
 * lookup (default: its MCP server; if Jira can't be reached, the names seen are all there is). How many were linked.
 */
export async function resolveJiraAccounts(opts: { lookup?: JiraLookup; ids?: number[] } = {}): Promise<{ linked: number }> {
  let linked = linkJiraAccounts();
  const taken = () => new Set(listPeople().flatMap((p) => p.accounts.filter((a) => a.kind === "jira").map((a) => a.value.toLowerCase())));
  const missing = listPeople().filter((p) => (!opts.ids || opts.ids.includes(p.id)) && !p.accounts.some((a) => a.kind === "jira") && usernameCandidates(p.name).length);
  if (!missing.length) return { linked };
  const find = async (lookup: JiraLookup) => {
    for (const p of missing) {
      const names = [p.name, ...p.aliases.filter((a) => a.trim().includes(" "))];
      for (const candidate of usernameCandidates(p.name)) {
        if (taken().has(candidate)) continue;
        const profile = await lookup(candidate);
        if (!profile) continue; // (the first of the pattern needn't exist: a person can be …1 only)
        if (names.some((n) => nameSimilar(n, profile.displayName)) && !taken().has(profile.username.toLowerCase())) {
          if (addAccount(p.id, "jira", profile.username)) linked++;
          break;
        }
      }
    }
  };
  try {
    if (opts.lookup) await find(opts.lookup);
    else await withJiraLookup(find);
  } catch {
    // Jira not reachable: what the names told is all there is
  }
  return { linked };
}

/** A note as it goes to Jira: its words with the tagged people as mentions — and a hash of that (what a synced comment is compared by). */
export function jiraNoteBody(raw: string, people?: Person[]): { text: string; hash: string; noAccount: string[] } {
  const { text, noAccount } = mentionsToJira(raw, people);
  return { text, hash: createHash("sha1").update(text).digest("hex"), noAccount };
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
