/**
 * People, normalized (a step after each briefing, with the People plugin): one person under all the
 * names they're mentioned by. The AI reads the names in your todos, your profiles (with their
 * aliases) and your contacts (WhatsApp chats, mail senders) and says which mention is which
 * person: a new way to call someone becomes their alias, someone you deal with (a contact) without a
 * profile gets one, two profiles that are one person are merged. Only what's unambiguous. Server only.
 */
import { and, desc, gte, isNotNull, ne } from "drizzle-orm";
import { promptText } from "@/lib/prompts";
import { getDb, getSqlite, schema } from "@/db";
import { runAi } from "@/lib/ai";
import { listTodos } from "@/lib/boards/store";
import { plain } from "@/lib/boards/collect";
import { errorMessage } from "@/lib/errors";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { addAliases, addRelation, createPerson, getPerson, listPeople, mergePeople, namesOf, namesThem, relationsOf, updatePerson, whatsappChats } from "./store";
import type { Person } from "./shared";
import type { TodoView } from "@/lib/boards/shared";

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
    relations: {
      type: "array",
      items: { type: "object", properties: { person: { type: "integer" }, rel: { type: "string" }, other: { type: "integer" }, evidence: { type: "string" } }, required: ["person", "rel", "other", "evidence"] },
    },
  },
  required: ["aliases", "people", "merges", "relations"],
};
type Answer = {
  aliases?: { person?: number; mention?: string }[];
  people?: { name?: string; aliases?: string[]; whatsapp?: string; email?: string }[];
  merges?: { keep?: number; drop?: number }[];
  relations?: { person?: number; rel?: string; other?: number; evidence?: string }[];
};

export const INSTRUCTIONS = `Du pflegst meine Personen-Profile, damit jede Person EINE Identität hat — egal, wie sie in meinen Todos genannt wird (Vorname, Nachname, „Herr X“, Spitzname, voller Name).

Unten stehen meine Profile (id, Name, Aliasse, WhatsApp-Chat, Mail-Adressen), meine Kontakte (WhatsApp-Chats, Mail-Absender) und meine Todos.

1. aliases: Eine Person, die in einem Todo anders genannt wird als in ihrem Profil (z. B. „Herr Meier“, wo das Profil „Thomas Meier“ heißt; ein Spitzname) → {person: ihre id, mention: die Nennung genau wie im Todo, ohne Genitiv-s und ohne „Herr“/„Frau“}. Nur, wenn eindeutig dieselbe Person (gleicher Nachname und es gibt keine zweite passende; derselbe Chat; dieselbe Adresse).
2. people: Eine Person, die in einem Todo vorkommt, kein Profil hat, aber ein Kontakt von mir ist (ein WhatsApp-Chat oder ein Mail-Absender unten) → {name: ihr voller Name (wie beim Kontakt), aliases: wie sie in den Todos genannt wird, whatsapp: der Chat-Name genau wie unten (oder leer), email: ihre Adresse (oder leer)}.
3. merges: Zwei Profile, die dieselbe Person sind (gleicher Chat, gleiche Adresse, ein Name ist eindeutig die Kurzform des anderen — oder ein Rollen- bzw. Verwandtschaftsname wie „Mama“, „Papa“, „Schwester“, „Chef“ gegen einen echten Namen, wenn die Hinweise es zeigen: schreibe ich in einem Chat „Hey Mama“, ist die Person dieses Chats „Mama“; stammen die Todos über „Mama“ aus Nachrichten eines Chats, ist es dessen Person — mehrere Hinweise auf denselben Chat sind ein klarer Beleg) → {keep: die id des vollständigeren (der echte Name), drop: die andere}. Die Hinweise stehen bei den Profilen, die Chat-Auszüge bei Profilen und Kontakten: „ich:“ sind meine Nachrichten, sonst die der Person.
4. relations: Wer ist wer für wen — jede Bezugnahme und jeder Querverweis, den meine Kontexte (Todos, Nachrichten, Erwähnungen unten) tragen, als strukturierte Beziehung: {person: die id des Profils, rel: was die Person ist, kurz und aus MEINER Sicht, wenn other 0 ist („Mutter“, „Schwester“, „Vermieter“, „Zahnärztin“, „Kollege“, „Ehefrau“), other: 0 = zu mir, sonst die id eines anderen Profils, zu dem die Beziehung besteht (dann aus Sicht von person als blankes Substantiv, ohne „von“: „Ehemann“, „Tochter“, „Chef“ — z. B. person Lotte, rel „Schwester“, other 0; person Max, rel „Sohn“, other Nadine), evidence: der Beleg in einem Satz (was im Kontext steht)}. Eine „Mama“, die zu einer Person gehört, ist ein merge bzw. alias — und wird zusätzlich als Beziehung „Mutter“ (other 0) festgehalten. Schon bekannte Beziehungen (bei den Profilen) nicht wiederholen.

Regeln: Nichts raten — im Zweifel weglassen. Keine Firmen, Teams, Rollen, Gruppenchats, Dienste. Nicht mich selbst („Ich“). Nichts doppelt: was schon Name oder Alias des Profils ist, nicht noch einmal. Beziehungen nur, wenn ein Kontext sie klar sagt oder nahelegt (z. B. „Hey Mama“, „meine Schwester Lotte“, „Nadines Mann“). Leere Listen, wenn nichts zu tun ist.`;

/**
 * What links a profile to a chat, from your own context: the chats where you address them by one of
 * their names ("Hey Mama, …" in the chat with Johanna Roessler) and the chats the todos naming them
 * come from (the todo "Mutter fragen, …" was made from messages of that chat). One line per profile
 * with such evidence — the AI derives from it who "Mama" is.
 */
function evidence(people: Person[], todos: TodoView[]): Map<number, string> {
  const out = new Map<number, string[]>();
  const add = (id: number, line: string) => out.set(id, [...(out.get(id) ?? []), line]);
  const sqlite = getSqlite();
  const chatOf = (key: string) => {
    const conv = key.split("|")[0];
    return /^(wa|sg):/.test(conv) ? conv.slice(3) : null;
  };
  for (const p of people) {
    // Their chat is known (set on the profile): nothing to find.
    if (p.whatsapp) continue;
    // 1. Where I write to them by name.
    const byChat = new Map<string, string>();
    for (const form of namesOf(p).filter((n) => n.length >= 3 && !/\s/.test(n))) {
      const rows = sqlite
        .prepare("select conv_id, preview from emails where from_name = 'Ich' and (conv_id like 'wa:%' or conv_id like 'sg:%') and preview like ? order by received_at desc limit 40")
        .all(`%${form}%`) as { conv_id: string; preview: string }[];
      for (const r of rows) if (!byChat.has(r.conv_id) && namesThem(p, r.preview)) byChat.set(r.conv_id, r.preview);
    }
    for (const [conv, preview] of [...byChat].slice(0, 2)) add(p.id, `im Chat „${conv.slice(3)}“ schreibe ich: „${plain(preview, 80)}“`);
    // 2. Where the todos about them come from.
    const fromChats = new Map<string, number>();
    for (const todo of todos) {
      if (!namesThem(p, todo.text)) continue;
      for (const c of new Set(todo.refs.filter((r) => r.startsWith("mail:")).map((r) => chatOf(r.slice(5))).filter((x): x is string => !!x))) fromChats.set(c, (fromChats.get(c) ?? 0) + 1);
    }
    for (const [chat, n] of [...fromChats].sort((a, b) => b[1] - a[1]).slice(0, 2)) add(p.id, `${n} Todo${n === 1 ? "" : "s"} über sie stammen aus Nachrichten des Chats „${chat}“`);
  }
  return new Map([...out].map(([id, lines]) => [id, ` — Hinweise: ${lines.join("; ")}`]));
}

/** Where a profile is mentioned in your messages and mails (not in their own chat): the context its relations are read from. */
function mentions(people: Person[]): Map<number, string> {
  const stmt = getSqlite().prepare("select conv_id, from_name, preview from emails where preview like ? order by received_at desc limit 30");
  const out = new Map<number, string>();
  for (const p of people.slice(0, 80)) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const form of namesOf(p).filter((n) => n.length >= 3).slice(0, 4)) {
      for (const r of stmt.all(`%${form}%`) as { conv_id: string; from_name: string | null; preview: string }[]) {
        if (lines.length >= 3) break;
        if (!namesThem(p, r.preview) || (p.whatsapp && r.conv_id === `wa:${p.whatsapp}`) || seen.has(r.preview)) continue;
        seen.add(r.preview);
        const where = /^(wa|sg):/.test(r.conv_id) ? `Chat „${r.conv_id.slice(3)}“` : "Mail";
        lines.push(`${where}, ${r.from_name === "Ich" ? "ich" : (r.from_name ?? "?")}: „${plain(r.preview, 110)}“`);
      }
    }
    if (lines.length) out.set(p.id, ` — erwähnt: ${lines.join(" | ")}`);
  }
  return out;
}

const flag = globalThis as { __zeffPeopleNormalize?: boolean };
export const peopleNormalizing = () => !!flag.__zeffPeopleNormalize;

export type NormalizeResult = { ok: boolean; aliases: number; created: number; merged: number; relations: number; claims?: number; links?: number; error?: string };

/** The step after each briefing: names matched (AI), then what the new messages say about people read (extract.ts). */
export async function normalizePeople(): Promise<NormalizeResult> {
  if (flag.__zeffPeopleNormalize) return { ok: false, aliases: 0, created: 0, merged: 0, relations: 0, error: "already running" };
  flag.__zeffPeopleNormalize = true;
  try {
    const r = await matchNames();
    // What the new messages say about them — a failure here doesn't undo the matching.
    try {
      const x = await (await import("./extract")).extractKnowledge();
      return { ...r, claims: x.claims, links: x.links + x.derived };
    } catch {
      return r;
    }
  } finally {
    flag.__zeffPeopleNormalize = false;
  }
}

async function matchNames(): Promise<NormalizeResult> {
  try {
    // Jira users tied to profiles by name — no AI needed (so they're there for the @-mentions).
    try {
      (await import("./accounts")).linkJiraAccounts();
    } catch {
      // without accounts, then
    }
    // Names the sources write for people, queued for review (no AI).
    try {
      (await import("./identity")).findIdentitySuggestions();
    } catch {
      // the sources aren't there, then
    }
    const people = listPeople();
    // The todos: open ones, and those of the last 30 days.
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const todos = listTodos({ status: "all" }).filter((t) => t.status === "open" || (t.updatedAt ?? "") >= since);
    if (!todos.length) return { ok: true, aliases: 0, created: 0, merged: 0, relations: 0 };
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
    // The last words of a chat: how they're addressed there tells who "Mama" is.
    const sample = (chat: string) => {
      const rows = getSqlite().prepare("select from_name, preview from emails where conv_id = ? order by received_at desc limit 4").all(`wa:${chat}`) as { from_name: string | null; preview: string }[];
      return rows.length ? ` — Auszug: ${rows.reverse().map((r) => `${r.from_name === "Ich" ? "ich" : "sie/er"}: „${plain(r.preview, 70)}“`).join(" | ")}` : "";
    };
    const hints = evidence(people, todos);
    const said = mentions(people);
    const known = (id: number) => {
      const r = relationsOf(id).out;
      return r.length ? ` — bekannt: ${r.map((x) => `${x.rel}${x.otherId ? ` von [${x.otherId}]` : ""}`).join(", ")}` : "";
    };
    const prompt = [
      promptText("people-normalize", INSTRUCTIONS),
      "",
      "# Meine Profile",
      ...(people.length ? people.map((p) => `- [${p.id}] ${p.name}${p.aliases.length ? ` — auch: ${p.aliases.join(", ")}` : ""}${p.whatsapp ? ` — WhatsApp: ${p.whatsapp}${sample(p.whatsapp)}` : ""}${p.emails.length ? ` — ${p.emails.join(", ")}` : ""}${hints.get(p.id) ?? ""}${said.get(p.id) ?? ""}${known(p.id)}`) : ["(noch keine)"]),
      "",
      "# Meine Kontakte",
      ...chats.map((c) => `- WhatsApp-Chat: ${c.name}${people.some((p) => p.whatsapp === c.name) ? "" : sample(c.name)}`),
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
    // Relations last (after merges, aliases and new profiles: ids may have changed). Only with a stated evidence.
    let relations = 0;
    for (const r of (answer?.relations ?? []).slice(0, 60)) {
      const other = Number(r.other) || 0;
      if (!getPerson(Number(r.person)) || (other && !getPerson(other)) || !(r.rel ?? "").trim() || !(r.evidence ?? "").trim()) continue;
      if (addRelation(Number(r.person), r.rel!, other, r.evidence!)) relations++;
    }
    return { ok: true, aliases, created, merged, relations };
  } catch (e) {
    return { ok: false, aliases: 0, created: 0, merged: 0, relations: 0, error: errorMessage(e) };
  }
}
