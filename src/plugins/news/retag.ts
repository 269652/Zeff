import { clusterStories } from "./cluster";
import { analyze } from "./keyphrase";
import { corpusForTagging, getPrefs, setStories, setTags, untaggedByAi } from "./store";

/**
 * Tags for the kept items, two layers:
 *   · the corpus tagger (always, no AI): after each sync every recent item gets its names and topics, decided with all the
 *     headlines in view;
 *   · the AI (optional, LLM plugin): a batch of the best unseen headlines per sync is tagged by the AI — canonical names,
 *     topics as short nouns, and a label for the concrete story the headline is about (the same label on every item about
 *     it, across sources). The AI's tags replace the corpus tagger's for those items and are kept.
 */

/**
 * The text analytics over the recent items (no AI): keyphrase tags with a normalisation pass, and the stories — reports grouped by
 * content. The AI's tags are left as they are. Returns how many items were tagged.
 */
export function retagAll(): number {
  const items = corpusForTagging(7, 6000);
  if (!items.length) return 0;
  const a = analyze(items);
  setTags(items.filter((i) => i.src !== "ai").map((i) => ({ id: i.id, tags: (a.tags.get(i.id) ?? []).map((t) => t.name), src: "auto" as const })));
  // Stories: a label per cluster (made unique by the day when two share one); items in none lose their old label.
  const stories = clusterStories(items.map((i) => ({ id: i.id, at: i.at })), a.vectors, a.tags);
  const label = new Map<number, string>();
  const used = new Map<string, number>();
  for (const s of stories) {
    const n = (used.get(s.label) ?? 0) + 1;
    used.set(s.label, n);
    const name = n === 1 ? s.label : `${s.label} (${s.lastAt.slice(5, 10).replace("-", ".")}.)`;
    for (const id of s.items) label.set(id, name);
  }
  setStories(items.map((i) => ({ id: i.id, story: label.get(i.id) ?? "" })));
  return items.length;
}

type Tagging = { items?: { n?: number; tags?: unknown; story?: unknown }[] };

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          tags: { type: "array", items: { type: "string" }, description: "2–4 Schlagworte: Personen, Organisationen, Orte, Unternehmen (kanonisch, deutsche Schreibweise) und 1–2 Themen als kurze Substantive." },
          story: { type: "string", description: "Kurzes Label des konkreten Ereignisses; dasselbe Label bei allen Meldungen über dasselbe Ereignis; leer, wenn es keins ist." },
        },
        required: ["n", "tags", "story"],
      },
    },
  },
  required: ["items"],
};

export function taggingPrompt(items: { n: number; title: string; summary: string }[]): string {
  return [
    "Du verschlagwortest Nachrichtenmeldungen für eine Entdecken-Funktion, in der man von Schlagwort zu Schlagwort springt.",
    "Für jede nummerierte Meldung:",
    "- tags: 2–4 Schlagworte. Personen, Organisationen, Orte und Unternehmen in kanonischer Schreibweise („Donald Trump“, „Deutsche Bahn“, „Bärbel Bas“), dazu 1–2 Themen als kurze Substantive („Cyberangriff“, „Klimaschutz“). Keine allgemeinen Wörter wie Nachrichten, Politik, Studie, Meldung, Update.",
    "- story: ein kurzes Label für das konkrete Ereignis, um das es geht („Energie-Waffenruhe Ukraine“, „Rücktritt Bärbel Bas“). Bei mehreren Meldungen über dasselbe Ereignis genau dasselbe Label benutzen. Leer lassen, wenn es kein einzelnes Ereignis ist (Ratgeber, Kolumne, Feature).",
    "Nutze nur, was in Titel und Kurztext steht. Gib für jede Nummer genau einen Eintrag.",
    "",
    ...items.map((i) => `${i.n}. ${i.title}${i.summary ? ` — ${i.summary.slice(0, 160)}` : ""}`),
  ].join("\n");
}

const clean = (t: unknown): string[] =>
  [...new Set((Array.isArray(t) ? t : []).filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2 && x.length <= 40))].slice(0, 4);

/** One AI batch: the best unseen items the AI hasn't tagged yet. Returns how many were tagged. `ask` is the AI call (tests give their own). */
export async function aiTagBatch(deps: { ask?: (prompt: string) => Promise<Tagging>; size?: number } = {}): Promise<number> {
  const prefs = getPrefs();
  if (!prefs.aiTags) return 0;
  if (!deps.ask) {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("llm")) return 0;
  }
  const items = untaggedByAi(deps.size ?? 40, Math.min(prefs.maxAgeDays, 3));
  if (!items.length) return 0;
  const ask =
    deps.ask ??
    (async (prompt: string) => {
      const { runAi } = await import("@/lib/ai");
      return (await runAi<Tagging>(prompt, SCHEMA, { task: "news-digest", timeoutMs: 4 * 60000, maxBudgetUsd: 0.25 })).output;
    });
  const numbered = items.map((it, i) => ({ n: i + 1, title: it.title, summary: it.summary }));
  const answer = await ask(taggingPrompt(numbered));
  const entries = (answer.items ?? []).flatMap((a) => {
    const it = items[(Number(a.n) || 0) - 1];
    const tags = clean(a.tags);
    if (!it || !tags.length) return [];
    return [{ id: it.id, tags, story: typeof a.story === "string" ? a.story.replace(/\s+/g, " ").trim().slice(0, 60) : "", src: "ai" as const }];
  });
  setTags(entries);
  return entries.length;
}

/** The corpus tagger, at most every ten minutes (an open page asks; the sync does it after every fetch anyway). */
export async function retagIfStale(nowMs: number = Date.now()): Promise<number> {
  const { getPref, setPref } = await import("@/lib/prefs");
  if (nowMs - Number(getPref<number>("news:retag-at", 0)) < 600_000) return 0;
  setPref("news:retag-at", nowMs);
  return retagAll();
}
