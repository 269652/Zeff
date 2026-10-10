import { ai } from "./llm";
import { searchChunks, searchEntities, type EntityHit } from "./search";

/**
 * Asking: the question (and the conversation so far) → the passages and entities the search finds
 * → Copilot answers from them only, citing them as [1], [2] … When the words alone find little,
 * Copilot first says what to look for (synonyms, German and English, the terms behind it).
 */

export type Turn = { role: "user" | "assistant"; text: string };
export type Source = { n: number; title: string; url: string; heading: string; excerpt: string };
export type Answer = { answer: string; sources: Source[]; entities: EntityHit[]; searchedFor: string; model: string | null; durationMs: number | null };

const EXPAND_SCHEMA = { type: "object", required: ["terms"], properties: { terms: { type: "array", items: { type: "string" } } } };
const ANSWER_SCHEMA = {
  type: "object",
  required: ["answer", "used"],
  properties: { answer: { type: "string" }, used: { type: "array", items: { type: "integer" } } },
};

async function expand(question: string): Promise<string[]> {
  const r = await ai<{ terms: string[] }>(
    "compile",
    `Jemand sucht in der Confluence-Dokumentation eines Software-Projekts nach einer Antwort auf diese Frage. Nenne 8–20 Suchbegriffe, mit denen man die passenden Seiten findet: Fachbegriffe, Synonyme, deutsche UND englische Wörter, Systemnamen, Abkürzungen. Nur JSON: {"terms": [...]}\n\nFrage: ${question}`,
    EXPAND_SCHEMA,
    { timeoutMs: 120000 },
  );
  return (r.output?.terms ?? []).filter((t) => typeof t === "string").slice(0, 20);
}

export async function ask(question: string, history: Turn[] = []): Promise<Answer> {
  const recent = history.slice(-6);
  const context = [...recent.filter((t) => t.role === "user").map((t) => t.text), question].join(" ");
  let searchedFor = question;
  // The words asked, and what the AI says to look for besides (synonyms, the other language, the
  // terms behind it) — the best of both, alternately.
  const direct = searchChunks(context, 16);
  const terms = await expand(question).catch(() => [] as string[]);
  if (terms.length) searchedFor = `${question} · ${terms.join(", ")}`;
  const wider = terms.length ? searchChunks(`${question} ${terms.join(" ")}`, 16) : [];
  const seen = new Set<string>();
  const chunks: typeof direct = [];
  let budget = 20000;
  for (let i = 0; i < 16 && budget > 0; i++)
    for (const c of [wider[i], direct[i]]) {
      if (!c || seen.has(String(c.id)) || budget <= 0) continue;
      seen.add(String(c.id));
      chunks.push(c);
      budget -= c.text.length;
    }
  const entities = searchEntities(searchedFor, 6);
  const sources: Source[] = chunks.map((c, i) => ({ n: i + 1, title: c.title, url: c.url, heading: c.heading, excerpt: c.text }));
  if (!sources.length && !entities.length) {
    return { answer: "Dazu habe ich in der Wissensbasis nichts gefunden.", sources: [], entities: [], searchedFor, model: null, durationMs: null };
  }
  const graph = entities
    .map((e) => `- ${e.name} (${e.type}): ${e.summary}${e.related.length ? `\n  ${e.related.map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`)).join("; ")}` : ""}`)
    .join("\n");
  const prompt = `Du beantwortest Fragen zur Dokumentation (Confluence) eines Software-Projekts — nur aus den Quellen unten. Zitiere die Quellen im Text als [1], [2] …; was sich aus ihnen nicht ergibt, sag offen. Antworte in der Sprache der Frage, knapp und konkret (Markdown erlaubt). Gib in "used" die Nummern der Quellen an, die du benutzt hast. Nur JSON: {"answer": "...", "used": [1, 2]}

${recent.length ? `Bisheriges Gespräch:\n${recent.map((t) => `${t.role === "user" ? "Frage" : "Antwort"}: ${t.text.slice(0, 1500)}`).join("\n")}\n\n` : ""}Frage: ${question}

Wissensgraph (Entitäten und Beziehungen):
${graph || "(keine)"}

Quellen:
${sources.map((x) => `[${x.n}] „${x.title}“${x.heading ? ` › ${x.heading}` : ""}\n${x.excerpt}`).join("\n\n")}`;
  const r = await ai<{ answer: string; used: number[] }>("ask", prompt.slice(0, 30000), ANSWER_SCHEMA, { timeoutMs: 300000 });
  const used = new Set((r.output?.used ?? []).map(Number));
  return {
    answer: r.output?.answer ?? "",
    sources: sources.filter((x) => used.has(x.n) || (r.output?.answer ?? "").includes(`[${x.n}]`)).map((x) => ({ ...x, excerpt: x.excerpt.slice(0, 400) })),
    entities,
    searchedFor,
    model: r.model,
    durationMs: r.durationMs,
  };
}
