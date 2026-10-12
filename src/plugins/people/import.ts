import { desc, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runAi } from "@/lib/ai";
import { jiraUsers } from "./accounts";
import { addAccount, addAliases, createPerson, listPeople, updatePerson } from "./store";
import type { Person } from "./shared";

/**
 * Import people from your context (the People plugin): what came in over the last days — mails,
 * WhatsApp and Signal chats, Teams, Jira (tickets, comments, who's on them), GitLab — is gone through
 * by the AI (the LLM layer), which says who the real people in it are: with their other names, mail
 * addresses, chat and Jira user. New people get a profile, those you have get what's new about
 * them. Systems, newsletters, groups and you are no people. Server only.
 */

export type ImportedPerson = { name?: string; aliases?: string[]; emails?: string[]; whatsapp?: string; jira?: string; why?: string };
export type ImportDeps = { ask: (prompt: string) => Promise<{ people?: ImportedPerson[] }> };
export type ImportResult = { created: number; updated: number; candidates: number };

const SCHEMA = {
  type: "object",
  required: ["people"],
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Der volle Name (Vor- und Nachname, wenn bekannt)." },
          aliases: { type: "array", items: { type: "string" }, description: "Andere Namen derselben Person (Kurzform, Spitzname, „Herr X“) — nur was in den Daten steht." },
          emails: { type: "array", items: { type: "string" } },
          whatsapp: { type: "string", description: "Der Name ihres WhatsApp- oder Signal-Chats, wenn es einen gibt." },
          jira: { type: "string", description: "Ihr Jira-Benutzername (aus „Name (benutzername)“), wenn bekannt." },
          why: { type: "string", description: "Woran du sie erkannt hast, kurz." },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Du ziehst aus meinem Kontext der letzten Tage die Menschen heraus, mit denen ich zu tun habe — für meine Personen-Profile.

Unten stehen die Kontakte (Absender, Chats, Beteiligte), einige Texte und meine bestehenden Profile. Gib jede echte Person EINMAL an, mit ihrem vollen Namen; dieselbe Person unter mehreren Namen (Teams-Name, Mail-Absender, Jira-Name, Chat) fasst du zusammen und nennst die anderen Namen unter aliases. Hat sie eine Mail-Adresse, einen Chat oder einen Jira-Benutzernamen in den Daten, gib sie an (emails, whatsapp, jira) — nichts erfinden. Auch Personen, die nur im Text vorkommen („Nikolai und ich …“), gehören dazu, wenn klar ist, dass es ein Mensch ist, mit dem ich arbeite.

Keine Personen sind: Systeme, Benachrichtigungen, Newsletter, Firmen, Teams, Gruppen, Rollen, Dienste, Bots — und ich selbst. Wer schon in meinen Profilen steht, nennst du nur, wenn du etwas Neues über sie weißt (eine Adresse, einen Alias, ein Jira-Konto). Im Zweifel weglassen.`;

const SYSTEMISH = /no-?reply|do-?not-?reply|notification|benachrichtigung|mailer|newsletter|noreply|bounce|^jira\b|gitlab|support@|info@|service@|^system/i;
const isPersonName = (name: string, me: Set<string>) => {
  const n = name.trim();
  return n.length >= 3 && /\p{L}{2}/u.test(n) && !SYSTEMISH.test(n) && !me.has(n.toLowerCase()) && !/^(ich|me|team|admin)$/i.test(n);
};
const clip = (s: string | null | undefined, n: number) => {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

/** Who and what came in over the last `days`, as lines for the AI: contacts first (counted), then some texts. */
function gather(days: number, budget: number): { lines: string[]; contacts: number } {
  const db = getDb();
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const contacts = new Map<string, { line: string; n: number }>();
  const add = (key: string, make: (n: number) => string) => {
    const c = contacts.get(key);
    const n = (c?.n ?? 0) + 1;
    contacts.set(key, { n, line: make(n) });
  };
  const texts: { at: string; line: string }[] = [];

  const mails = db.select().from(schema.emails).where(gte(schema.emails.receivedAt, since)).orderBy(desc(schema.emails.receivedAt)).limit(1500).all();
  for (const m of mails) {
    const chat = /^(wa|sg):/.exec(m.convId);
    const who = chat ? m.convId.slice(3) : (m.fromName ?? "").trim();
    if (!who || /^(ich|me)$/i.test(who) || (m.isGroup && chat)) {
      if (m.preview) texts.push({ at: m.receivedAt, line: `[${chat ? (chat[1] === "wa" ? "WhatsApp" : "Signal") : "Mail"}] ich: ${clip(m.preview, 160)}` });
      continue;
    }
    if (!chat && (SYSTEMISH.test(who) || SYSTEMISH.test(m.fromEmail ?? ""))) continue;
    const kind = chat ? (chat[1] === "wa" ? "WhatsApp-Chat" : "Signal-Chat") : "Mail";
    add(`${kind}:${who.toLowerCase()}`, (n) => `- ${kind}: ${who}${m.fromEmail && !chat ? ` <${m.fromEmail}>` : ""} (${n}×${!chat ? `, zuletzt „${clip(m.subject, 60)}“` : ""})`);
    texts.push({ at: m.receivedAt, line: `[${kind}] ${who}: ${clip(`${chat ? "" : `${m.subject} — `}${m.preview}`, 200)}` });
  }
  const teams = db.select().from(schema.teamsMessages).where(gte(schema.teamsMessages.sentAt, since)).orderBy(desc(schema.teamsMessages.sentAt)).limit(1500).all();
  for (const m of teams) {
    const who = (m.senderName ?? "").trim();
    if (who && !SYSTEMISH.test(who)) add(`teams:${who.toLowerCase()}`, (n) => `- Teams: ${who}${m.place ? ` in ${m.place}` : ""} (${n}×)`);
    if (m.text) texts.push({ at: m.sentAt, line: `[Teams${m.place ? ` ${m.place}` : ""}] ${who || "?"}: ${clip(m.text, 220)}` });
  }
  for (const c of db.select().from(schema.jiraComments).where(gte(schema.jiraComments.at, since)).orderBy(desc(schema.jiraComments.at)).limit(800).all()) {
    if (c.author && !SYSTEMISH.test(c.author)) add(`jira:${c.author.toLowerCase()}`, (n) => `- Jira-Kommentare: ${c.author} (${n}×)`);
    texts.push({ at: c.at, line: `[Jira ${c.ticket}] ${c.author}: ${clip(c.body, 220)}` });
  }
  for (const g of db.select().from(schema.gitlabItems).where(gte(schema.gitlabItems.createdAt, since)).orderBy(desc(schema.gitlabItems.createdAt)).limit(500).all()) {
    if (g.author && !SYSTEMISH.test(g.author)) add(`gitlab:${g.author.toLowerCase()}`, (n) => `- GitLab: ${g.author} (${n}×)`);
  }
  // Jira users, as the briefing lists them on the tickets: "Name (benutzername)".
  for (const [key, u] of jiraUsers()) add(`jirauser:${key}`, () => `- Jira-Benutzer: ${u.name} (${u.user})`);

  const lines: string[] = [];
  let used = 0;
  const push = (line: string) => {
    if (used + line.length > budget) return false;
    used += line.length + 1;
    lines.push(line);
    return true;
  };
  push("# Kontakte der letzten Tage");
  for (const c of [...contacts.values()].sort((a, b) => b.n - a.n)) if (!push(c.line)) break;
  push("");
  push("# Texte (neueste zuerst)");
  for (const t of texts.sort((a, b) => b.at.localeCompare(a.at))) if (!push(t.line)) break;
  return { lines, contacts: contacts.size };
}

/** Whether a found person is one of those already there: by name, alias, address, chat or Jira user. */
function existing(p: ImportedPerson, people: Person[]): Person | undefined {
  const names = [p.name, ...(p.aliases ?? [])].map((x) => (x ?? "").trim().toLowerCase()).filter(Boolean);
  const emails = (p.emails ?? []).map((e) => e.trim().toLowerCase());
  return people.find(
    (x) =>
      [x.name, ...x.aliases].some((n) => names.includes(n.toLowerCase())) ||
      x.emails.some((e) => emails.includes(e.toLowerCase())) ||
      (!!p.whatsapp && x.whatsapp.toLowerCase() === p.whatsapp.trim().toLowerCase()) ||
      (!!p.jira && x.accounts.some((a) => a.kind === "jira" && a.value.toLowerCase() === p.jira!.trim().toLowerCase())),
  );
}

const realDeps = (): ImportDeps => ({
  ask: async (prompt) => (await runAi<{ people?: ImportedPerson[] }>(prompt, SCHEMA, { task: "people-normalize", timeoutMs: 8 * 60000, maxBudgetUsd: 1 })).output,
});

/**
 * Import the people of the last `days` (14) from your context through the AI: new ones get a profile
 * (with their other names, addresses, chat and Jira user), those you have get what's new. Throws
 * when the AI fails — nothing is changed then.
 */
export async function importPeopleFromContext(opts: { days?: number; ask?: ImportDeps["ask"] } = {}): Promise<ImportResult> {
  const deps = opts.ask ? { ask: opts.ask } : realDeps();
  const { lines, contacts } = gather(opts.days ?? 14, 17000);
  const people = listPeople();
  const { myJiraName } = await import("@/lib/jira/store");
  const me = new Set(["ich", ...[myJiraName()].filter((n): n is string => !!n).map((n) => n.toLowerCase())]);
  const prompt = [
    INSTRUCTIONS,
    "",
    `Ich bin ${[...me].filter((m) => m !== "ich")[0] ?? "der Nutzer"}.`,
    "",
    ...lines,
    "",
    "# Meine bestehenden Profile",
    ...(people.length ? people.map((p) => `- ${p.name}${p.aliases.length ? ` — auch: ${p.aliases.join(", ")}` : ""}${p.accounts.length ? ` — Jira: ${p.accounts.map((a) => a.value).join(", ")}` : ""}`) : ["(keine)"]),
  ].join("\n");
  const answer = await deps.ask(prompt);
  let created = 0;
  let updated = 0;
  for (const found of answer?.people ?? []) {
    const name = (found.name ?? "").trim();
    if (!isPersonName(name, me)) continue;
    const aliases = (found.aliases ?? []).map((a) => a.trim()).filter((a) => a.length >= 2 && a.toLowerCase() !== name.toLowerCase());
    const emails = (found.emails ?? []).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e) && !SYSTEMISH.test(e));
    const have = existing({ ...found, name }, listPeople());
    if (!have) {
      const id = createPerson({ name, aliases, emails, whatsapp: found.whatsapp?.trim() ?? "" });
      if (found.jira?.trim()) addAccount(id, "jira", found.jira.trim());
      created++;
      continue;
    }
    let changed = addAliases(have.id, [...aliases, ...(name.toLowerCase() === have.name.toLowerCase() ? [] : [name])]) > 0;
    const newEmails = emails.filter((e) => !have.emails.some((x) => x.toLowerCase() === e.toLowerCase()));
    if (newEmails.length) {
      updatePerson(have.id, { emails: [...have.emails, ...newEmails] });
      changed = true;
    }
    if (found.whatsapp?.trim() && !have.whatsapp) {
      updatePerson(have.id, { whatsapp: found.whatsapp.trim() });
      changed = true;
    }
    if (found.jira?.trim() && addAccount(have.id, "jira", found.jira.trim())) changed = true;
    if (changed) updated++;
  }
  return { created, updated, candidates: contacts };
}
