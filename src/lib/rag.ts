import { desc, like, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Retrieval on demand (RAG) for the AI steps. They run closed — no tools — so context that wasn't
 * in the prompt can't be fetched by the AI itself: it says what it's missing (`needs`: search words,
 * optionally the sources), Zeff looks through everything it keeps (the knowledge base, mails, Teams
 * and GitLab messages, Jira tickets and comments, your notes, facts, todos) and asks again with
 * what it found — see askWithRetrieval. Nothing is put into a prompt beforehand for this.
 */

const { emails, teamsMessages, gitlabItems, jiraComments, jiraTickets, contexts, facts } = schema;

export const RAG_SOURCES = ["knowledge", "mails", "teams", "gitlab", "jira", "notes", "facts", "todos"] as const;
export type RagSource = (typeof RAG_SOURCES)[number];

/** What an AI step asks for when it misses context: search words, in all sources or only in some. */
export type Need = { query: string; where?: string[] };
export type RagHit = { source: RagSource; ref: string; title: string; text: string; when?: string };

/** What a step adds to its prompt so the AI knows it can ask — and how. */
export const RAG_INSTRUCTIONS = `Fehlt dir Kontext, um sicher zu antworten (ein Name, ein Beschluss, was in einer Rückfrage steht, wie etwas funktioniert), rate nicht: lass die Antwort leer und nenne unter needs bis zu 3 Suchanfragen — query: 2–5 Suchwörter, die in den gesuchten Texten stehen dürften; where (optional): knowledge (Dokumentation), mails, teams, gitlab, jira, notes, facts, todos. Zeff sucht dort und fragt dich mit den Fundstellen noch einmal. Ist der Kontext unten schon ausreichend, antworte gleich und lass needs weg.`;

/** The optional `needs` field added to a step's answer schema. */
const NEEDS_PROPERTY = {
  type: "array",
  description: "Nur wenn dir Kontext fehlt und die Antwort leer bleibt: was Zeff für dich nachschlagen soll.",
  items: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "2–5 Suchwörter." },
      where: { type: "array", items: { type: "string", enum: [...RAG_SOURCES] }, description: "Nur in diesen Quellen suchen (sonst in allen)." },
    },
  },
};

const STOP = new Set("der die das den dem des und oder ist sind war was wer wie wo wann warum für ein eine einer einen mit von zum zur nicht auch bei aus nach über the and for with that this what who how why are was were you your".split(" "));
export const wordsOf = (q: string) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 6);
const clip = (s: string | null | undefined, n: number) => {
  const flat = (s ?? "").replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

export type Candidate = RagHit & { score: number };
type Searcher = (words: string[], q: string) => Promise<Candidate[]> | Candidate[];

/** Rows with any of the words in any of the columns, newest first (the ranking by how many words match is done after). */
const anyWord = (cols: Parameters<typeof like>[0][], words: string[]): SQL | undefined => or(...cols.flatMap((c) => words.map((w) => like(c, `%${w}%`))));
const scored = <T>(rows: T[], words: string[], textOf: (r: T) => string, make: (r: T) => Omit<RagHit, "source">, source: RagSource): Candidate[] =>
  rows.flatMap((r) => {
    const hay = textOf(r).toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    return score ? [{ ...make(r), source, score }] : [];
  });

export const SEARCHERS: Record<Exclude<RagSource, "knowledge">, Searcher> = {
  mails: (words) =>
    scored(
      getDb().select().from(emails).where(anyWord([emails.subject, emails.preview, emails.fromName], words)).orderBy(desc(emails.receivedAt)).limit(40).all(),
      words,
      (m) => `${m.subject} ${m.preview} ${m.fromName ?? ""}`,
      (m) => ({ ref: `mail:${m.key}`, title: `${m.fromName ?? m.fromEmail ?? "?"}: ${clip(m.subject, 120)}`, text: clip(m.preview, 400), when: m.receivedAt.slice(0, 10) }),
      "mails",
    ),
  teams: (words) =>
    scored(
      getDb().select().from(teamsMessages).where(anyWord([teamsMessages.text, teamsMessages.senderName, teamsMessages.place], words)).orderBy(desc(teamsMessages.sentAt)).limit(40).all(),
      words,
      (m) => `${m.text} ${m.senderName ?? ""} ${m.place ?? ""}`,
      (m) => ({ ref: `teams:${m.key}`, title: `${m.senderName ?? "?"}${m.place ? ` in ${m.place}` : ""}`, text: clip(m.text, 400), when: m.sentAt.slice(0, 10) }),
      "teams",
    ),
  gitlab: (words) =>
    scored(
      getDb().select().from(gitlabItems).where(anyWord([gitlabItems.title, gitlabItems.body, gitlabItems.branch], words)).orderBy(desc(gitlabItems.createdAt)).limit(40).all(),
      words,
      (g) => `${g.title} ${g.body} ${g.branch ?? ""}`,
      (g) => ({ ref: `gitlab:${g.key}`, title: `${g.ref} ${clip(g.title, 100)}${g.author ? ` (${g.author})` : ""}`, text: clip(g.body, 400), when: (g.createdAt ?? "").slice(0, 10) }),
      "gitlab",
    ),
  jira: (words) => [
    ...scored(
      getDb().select().from(jiraComments).where(anyWord([jiraComments.body, jiraComments.author], words)).orderBy(desc(jiraComments.at)).limit(40).all(),
      words,
      (c) => `${c.body} ${c.author} ${c.ticket}`,
      (c) => ({ ref: `jira-comment:${c.id}`, title: `${c.ticket} · ${c.author}`, text: clip(c.body, 400), when: c.at.slice(0, 10) }),
      "jira",
    ),
    ...scored(
      getDb().select().from(jiraTickets).where(anyWord([jiraTickets.key, jiraTickets.summary, jiraTickets.description], words)).orderBy(desc(jiraTickets.updatedAt)).limit(20).all(),
      words,
      (t) => `${t.key} ${t.summary} ${t.description ?? ""}`,
      (t) => ({ ref: t.key, title: `${t.key} · ${clip(t.summary, 100)} (${t.status})`, text: clip(t.description, 300), when: (t.updatedAt ?? "").slice(0, 10) }),
      "jira",
    ),
  ],
  notes: (words) =>
    scored(
      getDb().select().from(contexts).where(anyWord([contexts.title, contexts.body, contexts.author], words)).orderBy(desc(contexts.id)).limit(40).all(),
      words,
      (c) => `${c.title ?? ""} ${c.body} ${c.author ?? ""}`,
      (c) => ({ ref: `context:${c.id}`, title: `${c.author ? `${c.author}: ` : ""}${clip(c.title, 100)}${c.ticket ? ` (${c.ticket})` : ""}`, text: clip(c.body, 400), when: (c.date ?? c.createdAt).slice(0, 10) }),
      "notes",
    ),
  facts: (words) =>
    scored(
      getDb().select().from(facts).where(anyWord([facts.subject, facts.text], words)).orderBy(desc(facts.id)).limit(30).all(),
      words,
      (f) => `${f.subject} ${f.text}`,
      (f) => ({ ref: `fact:${f.id}`, title: clip(f.subject, 100), text: clip(f.text, 400), when: f.updatedAt.slice(0, 10) }),
      "facts",
    ),
  todos: async (words, q) => {
    const { searchTodos } = await import("@/lib/boards/store");
    // searchTodos wants every word: the whole query first, then the single words.
    const found = new Map<number, ReturnType<typeof searchTodos>[number]>();
    for (const t of [...searchTodos(q, 6), ...words.flatMap((w) => searchTodos(w, 4))]) found.set(t.id, t);
    return [...found.values()].map((t) => ({ source: "todos" as const, ref: t.ref, title: `${t.ref}${t.ticket ? ` · ${t.ticket}` : ""} (${t.status})`, text: clip(`${t.text}${t.note ? ` — ${t.note}` : ""}`, 400), when: (t.doneAt ?? t.createdAt).slice(0, 10), score: words.filter((w) => `${t.text} ${t.note ?? ""}`.toLowerCase().includes(w)).length }));
  },
};

export type RetrieveOpts = {
  /** The knowledge base's pages for some words (default: the knowledge server's search). */
  knowledge?: (query: string) => Promise<{ title: string; snippet: string }[]>;
  /** Hits per source and need. */
  perSource?: number;
  /** About this many characters of text in all. */
  maxChars?: number;
};

async function realKnowledge(query: string) {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("knowledge")) return [];
  const { knowledgeSearch } = await import("@/plugins/knowledge/client");
  const r = await knowledgeSearch(query, 4);
  return r.pages.map((p) => ({ title: p.title, snippet: clip(p.snippet || p.summary || "", 700) }));
}

/**
 * Look for what the AI asked for: each need in the sources it names (else all) — the best hits per
 * source (those with the most of its words), as lines with their references. Never throws: a source
 * that fails just has nothing.
 */
export async function retrieve(needs: Need[], opts: RetrieveOpts = {}): Promise<{ text: string; hits: RagHit[] }> {
  const perSource = opts.perSource ?? 3;
  const maxChars = opts.maxChars ?? 7000;
  const seen = new Set<string>();
  const hits: RagHit[] = [];
  for (const need of needs.slice(0, 3)) {
    const q = String(need?.query ?? "").trim();
    const words = wordsOf(q);
    if (!words.length) continue;
    const where = (need.where ?? []).filter((w): w is RagSource => (RAG_SOURCES as readonly string[]).includes(w));
    const sources = where.length ? where : [...RAG_SOURCES];
    // Of many words at least two should match (one common word alone says little).
    const min = words.length >= 4 ? 2 : 1;
    for (const source of sources) {
      let found: Candidate[] = [];
      try {
        if (source === "knowledge") found = (await (opts.knowledge ?? realKnowledge)(q)).map((p) => ({ source, ref: `knowledge:${p.title}`, title: p.title, text: clip(p.snippet, 500), score: min }));
        else found = await SEARCHERS[source](words, q);
      } catch {
        found = [];
      }
      for (const h of found.filter((c) => c.score >= min).sort((a, b) => b.score - a.score || (b.when ?? "").localeCompare(a.when ?? "")).slice(0, perSource)) {
        if (seen.has(h.ref)) continue;
        seen.add(h.ref);
        hits.push({ source: h.source, ref: h.ref, title: h.title, text: h.text, when: h.when });
      }
    }
  }
  const lines: string[] = [];
  let used = 0;
  const kept: RagHit[] = [];
  for (const h of hits) {
    const line = `- [${h.ref}] (${h.source}${h.when ? ` · ${h.when}` : ""}) ${h.title}${h.text ? ` — ${h.text}` : ""}`;
    if (used + line.length > maxChars && kept.length) break;
    used += line.length;
    lines.push(line);
    kept.push(h);
  }
  return { text: lines.join("\n"), hits: kept };
}

type WithNeeds = { needs?: Need[] };

/**
 * Ask the AI, and while it says it misses context (`needs`) look it up and ask again with the
 * finds — at most `rounds` asks (default 2); the last one has no `needs` and must answer. A need
 * already looked up isn't looked up twice. `ask` gets the prompt and the schema of the round.
 */
export async function askWithRetrieval<T extends object>(o: {
  prompt: string;
  schema: object;
  ask: (prompt: string, schema: object) => Promise<T & WithNeeds>;
  retrieve?: (needs: Need[]) => Promise<{ text: string }>;
  rounds?: number;
}): Promise<T & WithNeeds> {
  const rounds = Math.max(1, o.rounds ?? 2);
  const fetch = o.retrieve ?? ((needs: Need[]) => retrieve(needs));
  const done = new Set<string>();
  let extra = "";
  for (let round = 1; ; round++) {
    const last = round >= rounds;
    const base = o.schema as { properties?: Record<string, unknown> };
    const schema = last ? o.schema : { ...base, properties: { ...base.properties, needs: NEEDS_PROPERTY } };
    const res = await o.ask(`${o.prompt}${extra}${last && round > 1 ? "\n\nDas ist die letzte Runde: antworte jetzt mit dem, was da ist." : ""}`, schema);
    const asked = (res.needs ?? []).filter((n) => String(n?.query ?? "").trim());
    if (last || !asked.length) return res;
    const needs = asked.filter((n) => !done.has(String(n.query).trim().toLowerCase()));
    // Asked again for what was looked up already: nothing more to find — it has to answer now.
    if (!needs.length) return o.ask(`${o.prompt}${extra}

Dazu wurde schon gesucht, mehr gibt es nicht: antworte jetzt mit dem, was da ist.`, o.schema);
    for (const n of needs) done.add(String(n.query).trim().toLowerCase());
    const found = await fetch(needs);
    extra += `\n\n# Nachgeholter Kontext (Runde ${round}; gesucht: ${needs.map((n) => `„${n.query}“`).join(", ")})\n${found.text || "(nichts gefunden)"}`;
  }
}

/** For prompts of the steps that can ask: the instructions (see RAG_INSTRUCTIONS) behind the step's own. */
export const withRagInstructions = (instructions: string) => `${instructions}\n\n${RAG_INSTRUCTIONS}`;

