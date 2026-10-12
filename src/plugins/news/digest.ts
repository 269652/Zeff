import { getPref, setPref } from "@/lib/prefs";
import { getPrefs, listItems } from "./store";

/**
 * The AI overview (optional, LLM plugin): from the best unread items — what matters today, in a few
 * sentences, and why each pick is for you. Only titles, short summaries and your interests go to the AI.
 */
export type Digest = { at: string; overview: string; picks: { id: number; why: string }[] };
type Answer = { overview?: string; picks?: { n?: number; why?: string }[] };

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2–4 Sätze: was heute wichtig ist." },
    picks: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, why: { type: "string", description: "Ein kurzer Satz: warum für diese Person." } }, required: ["n", "why"] } },
  },
  required: ["overview", "picks"],
};

export const getDigest = (): Digest | null => getPref<Digest | null>("news:digest", null);

export function digestPrompt(interests: string[], items: { n: number; source: string; title: string; summary: string }[]): string {
  return [
    "Du bist der Nachrichten-Assistent einer Person. Wähle aus den Meldungen die bis zu 5 wichtigsten für sie aus und fasse den Tag zusammen.",
    "Erfinde nichts: nur, was in den Titeln und Kurztexten steht. Antworte auf Deutsch, knapp.",
    `Interessen: ${interests.length ? interests.join(", ") : "(keine angegeben)"}`,
    "",
    "Meldungen:",
    ...items.map((i) => `${i.n}. [${i.source}] ${i.title}${i.summary ? ` — ${i.summary.slice(0, 200)}` : ""}`),
  ].join("\n");
}

/** Makes (and keeps) the overview of the top unread items. `ask` is the AI call (tests give their own). */
export async function buildDigest(deps: { ask?: (prompt: string) => Promise<Answer> } = {}): Promise<Digest | null> {
  const prefs = getPrefs();
  const items = listItems({ view: "foryou", limit: 12, maxAgeDays: Math.min(prefs.maxAgeDays, 2) }).filter((i) => i.state === "new");
  if (!items.length) return null;
  const ask =
    deps.ask ??
    (async (prompt: string) => {
      const { runAi } = await import("@/lib/ai");
      return (await runAi<Answer>(prompt, SCHEMA, { task: "news-digest", timeoutMs: 4 * 60000, maxBudgetUsd: 0.3 })).output;
    });
  const numbered = items.map((it, i) => ({ n: i + 1, source: it.sourceName, title: it.title, summary: it.summary }));
  const a = await ask(digestPrompt(prefs.interests.map((i) => i.term), numbered));
  const picks = (a.picks ?? []).flatMap((p) => {
    const it = items[(p.n ?? 0) - 1];
    return it && p.why ? [{ id: it.id, why: String(p.why).slice(0, 240) }] : [];
  });
  const digest: Digest = { at: new Date().toISOString(), overview: String(a.overview ?? "").slice(0, 900), picks: picks.slice(0, 5) };
  setPref("news:digest", digest);
  return digest;
}
