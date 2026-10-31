import { getContent, searchItems } from "./store";
import { fillPrompt, promptText } from "@/lib/prompts";
import type { NewsItem } from "./shared";

/** Its instructions — a page of System → Prompts. */
export const ASK_INSTRUCTIONS = "Beantworte die Frage nur anhand der Quellen unten (Nachrichten, die die Person gesammelt hat). Erfinde nichts und nutze kein Wissen von außerhalb.\nBelege jede Aussage mit der Nummer der Quelle in eckigen Klammern, z. B. [2]. Sagen die Quellen nichts dazu, antworte genau das.";

/**
 * Ask your news (optional, LLM plugin): a question answered from what Zeff has fetched — like asking a notebook. The
 * question's words search the kept items (headlines, summaries, the full articles where read), the best dozen go to the AI
 * with their text, and it answers only from them, citing the numbers — which come back as links. Nothing outside the
 * fetched news is used, and if the news doesn't say, it says so.
 */
export type NewsAnswer = { answer: string; sources: { n: number; id: number; title: string; url: string; sourceName: string }[] };
type Raw = { answer?: string; cites?: number[] };

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Die Antwort, knapp und auf Deutsch; Belege als [1], [2] im Text. Steht es nicht in den Quellen: das sagen." },
    cites: { type: "array", items: { type: "integer" }, description: "Die Nummern der Quellen, die du benutzt hast." },
  },
  required: ["answer", "cites"],
};

export function askPrompt(question: string, sources: { n: number; source: string; title: string; text: string }[]): string {
  return [
    promptText("news-ask", ASK_INSTRUCTIONS),
    `Frage: ${question}`,
    "",
    "Quellen:",
    ...sources.map((s) => `[${s.n}] (${s.source}) ${s.title}\n${s.text}`),
  ].join("\n");
}

export async function askNews(question: string, deps: { ask?: (prompt: string) => Promise<Raw>; limit?: number } = {}): Promise<NewsAnswer> {
  const q = question.trim();
  if (q.length < 3) throw new Error("Ask a question.");
  const items = searchItems(q, deps.limit ?? 12);
  if (!items.length) return { answer: "Dazu habe ich in deinen gesammelten Nachrichten nichts gefunden.", sources: [] };
  const ask =
    deps.ask ??
    (async (prompt: string) => {
      const { runAi } = await import("@/lib/ai");
      return (await runAi<Raw>(prompt, SCHEMA, { task: "news-ask", timeoutMs: 4 * 60000, maxBudgetUsd: 0.3 })).output;
    });
  const textOf = (it: NewsItem) => (it.hasContent ? (getContent(it.id)?.content ?? "").slice(0, 900) : it.summary);
  const sources = items.map((it, i) => ({ n: i + 1, item: it, source: it.sourceName, title: it.title, text: textOf(it) }));
  const raw = await ask(askPrompt(q, sources));
  const cited = new Set([...(raw.cites ?? []), ...[...String(raw.answer ?? "").matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))]);
  return {
    answer: String(raw.answer ?? "").slice(0, 3000),
    sources: sources.filter((s) => cited.has(s.n)).map((s) => ({ n: s.n, id: s.item.id, title: s.title, url: s.item.url, sourceName: s.source })),
  };
}
