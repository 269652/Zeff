/**
 * People, normalized (a step after each briefing, with the People plugin): one person under all the
 * names they're mentioned by. The AI reads the names in your todos, your profiles (with their
 * aliases) and your contacts (WhatsApp chats, mail senders) and says which mention is which
 * person: a new way to call someone becomes their alias, someone you deal with (a contact) without a
 * profile gets one, two profiles that are one person are merged. Only what's unambiguous. Server only.
 */
import { and, desc, gte, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { runAi } from "@/lib/ai";
import { listTodos } from "@/lib/boards/store";
import { plain } from "@/lib/boards/collect";
import { errorMessage } from "@/lib/errors";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { addAliases, createPerson, getPerson, listPeople, mergePeople, namesOf, updatePerson, whatsappChats } from "./store";

const { emails } = schema;

const SCHEMA = {
  type: "object",
  properties: {
    aliases: { type: "array", items: { type: "object", properties: { person: { type: "integer" }, mention: { type: "string" } }, required: ["person", "mention"] } },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, aliases: { type: "array", items: { type: "string" } }, whatsapp: { type: "string" }, email: { type: "string" } },
        required: ["name"],
      },
    },
    merges: { type: "array", items: { type: "object", properties: { keep: { type: "integer" }, drop: { type: "integer" } }, required: ["keep", "drop"] } },
  },
  required: ["aliases", "people", "merges"],
};
type Answer = {
  aliases?: { person?: number; mention?: string }[];
  people?: { name?: string; aliases?: string[]; whatsapp?: string; email?: string }[];
  merges?: { keep?: number; drop?: number }[];
};

const INSTRUCTIONS = `Du pflegst meine Personen-Profile, damit jede Person EINE Identität hat — egal, wie sie in meinen Todos genannt wird (Vorname, Nachname, „Herr X“, Spitzname, voller Name).

Unten stehen meine Profile (id, Name, Aliasse, WhatsApp-Chat, Mail-Adressen), meine Kontakte (WhatsApp-Chats, Mail-Absender) und meine Todos.

1. aliases: Eine Person, die in einem Todo anders genannt wird als in ihrem Profil (z. B. „Herr Meier“, wo das Profil „Thomas Meier“ heißt; ein Spitzname) → {person: ihre id, mention: die Nennung genau wie im Todo, ohne Genitiv-s und ohne „Herr“/„Frau“}. Nur, wenn eindeutig dieselbe Person (gleicher Nachname und es gibt keine zweite passende; derselbe Chat; dieselbe Adresse).
2. people: Eine Person, die in einem Todo vorkommt, kein Profil hat, aber ein Kontakt von mir ist (ein WhatsApp-Chat oder ein Mail-Absender unten) → {name: ihr voller Name (wie beim Kontakt), aliases: wie sie in den Todos genannt wird, whatsapp: der Chat-Name genau wie unten (oder leer), email: ihre Adresse (oder leer)}.
3. merges: Zwei Profile, die dieselbe Person sind (gleicher Chat, gleiche Adresse, ein Name ist eindeutig die Kurzform des anderen) → {keep: die id des vollständigeren, drop: die andere}.

Regeln: Nichts raten — im Zweifel weglassen. Keine Firmen, Teams, Rollen, Gruppenchats, Dienste. Nicht mich selbst („Ich“). Nichts doppelt: was schon Name oder Alias des Profils ist, nicht noch einmal. Leere Listen, wenn nichts zu tun ist.`;

const flag = globalThis as { __zeffPeopleNormalize?: boolean };
export const peopleNormalizing = () => !!flag.__zeffPeopleNormalize;

export type NormalizeResult = { ok: boolean; aliases: number; created: number; merged: number; error?: string };

export async function normalizePeople(): Promise<NormalizeResult> {
  if (flag.__zeffPeopleNormalize) return { ok: false, aliases: 0, created: 0, merged: 0, error: "already running" };
  flag.__zeffPeopleNormalize = true;
  try {
    const people = listPeople();
    // The todos: open ones, and those of the last 30 days.
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const todos = listTodos({ status: "all" }).filter((t) => t.status === "open" || (t.updatedAt ?? "") >= since);
    if (!todos.length) return { ok: true, aliases: 0, created: 0, merged: 0 };
    // Mentions not known yet are what's to do — the todos that name only known people (or none) are left out.
    const matcher = mentionMatcher(buildPeopleIndex(people));
    const unknownName = /(?<![\p{L}\p{N}])\p{Lu}[\p{Ll}]{2,}/u;
    const relevant = todos.filter((t) => splitMentions(t.text, matcher).some((m) => !m.person && unknownName.test(m.text)));
    const chats = whatsappChats().slice(0, 80);
    const senders = getDb()
      .selectDistinct({ name: emails.fromName, email: emails.fromEmail })
      .from(emails)
      .where(and(gte(emails.receivedAt, new Date(Date.now() - 120 * 864e5).toISOString()), isNotNull(emails.fromEmail), ne(emails.folder, "WhatsApp")))
      .orderBy(desc(emails.receivedAt))
      .limit(400)
      .all()
      .filter((s) => s.name && s.name !== "Ich" && /\s/.test(s.name) && !/no-?reply|newsletter|notification|mailer|support|info@|service/i.test(s.email ?? ""))
      .slice(0, 120);
    const prompt = [
      INSTRUCTIONS,
      "",
      "# Meine Profile",
      ...(people.length ? people.map((p) => `- [${p.id}] ${p.name}${p.aliases.length ? ` — auch: ${p.aliases.join(", ")}` : ""}${p.whatsapp ? ` — WhatsApp: ${p.whatsapp}` : ""}${p.emails.length ? ` — ${p.emails.join(", ")}` : ""}`) : ["(noch keine)"]),
      "",
      "# Meine Kontakte",
      ...chats.map((c) => `- WhatsApp-Chat: ${c.name}`),
      ...senders.map((s) => `- Mail: ${s.name} <${s.email}>`),
      "",
      "# Meine Todos",
      ...(relevant.length ? relevant : todos).slice(0, 120).map((t) => `- ${plain(t.text, 200)}`),
    ].join("\n");
    const answer = (await runAi<Answer>(prompt, SCHEMA, { task: "people-normalize", timeoutMs: 6 * 60000, maxBudgetUsd: 0.5 })).output;

    let merged = 0;
    for (const m of answer?.merges ?? []) {
      const keep = getPerson(Number(m.keep));
      const drop = getPerson(Number(m.drop));
      if (!keep || !drop || keep.id === drop.id) continue;
      mergePeople(keep.id, drop.id);
      merged++;
    }
    // An alias only where it names no one else.
    const taken = (name: string, id: number) => listPeople().some((p) => p.id !== id && namesOf(p).some((n) => n.toLowerCase() === name.toLowerCase()));
    let aliases = 0;
    for (const a of answer?.aliases ?? []) {
      const p = getPerson(Number(a.person));
      const mention = (a.mention ?? "").replace(/^(herrn?|frau)\s+/i, "").trim();
      if (!p || mention.length < 2 || taken(mention, p.id)) continue;
      aliases += addAliases(p.id, [mention]);
    }
    // New profiles: only for a contact (their chat, their address) — at most ten per run.
    const chatNames = new Set(chats.map((c) => c.name));
    const addresses = new Set(senders.map((s) => (s.email ?? "").toLowerCase()));
    let created = 0;
    for (const n of (answer?.people ?? []).slice(0, 10)) {
      const name = (n.name ?? "").trim();
      const whatsapp = n.whatsapp && chatNames.has(n.whatsapp) ? n.whatsapp : "";
      const email = n.email && addresses.has(n.email.toLowerCase()) ? n.email.toLowerCase() : "";
      if (!name || (!whatsapp && !email) || taken(name, -1)) continue;
      const id = createPerson({ name, aliases: (n.aliases ?? []).filter((x) => !taken(x, -1)), whatsapp, emails: email ? [email] : [] });
      if (id) created++;
      // An existing profile by that name (createPerson found it): its contact added.
      const p = getPerson(id);
      if (p && whatsapp && !p.whatsapp) updatePerson(p.id, { whatsapp });
    }
    return { ok: true, aliases, created, merged };
  } catch (e) {
    return { ok: false, aliases: 0, created: 0, merged: 0, error: errorMessage(e) };
  } finally {
    flag.__zeffPeopleNormalize = false;
  }
}
