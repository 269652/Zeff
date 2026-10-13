import { decodeBody, parseFeed, type FeedItem } from "./feed";
import { analyze, cosine } from "./keyphrase";
import { fetchArticle } from "./reader";
import { topicFeedUrl } from "./shared";
import { addItems, addSources, getContent, getItem, getPrefs, idsByUrls, learnedTop, listSources, searchItems, setReasons, setSimilar } from "./store";

/**
 * "More like this": the article is read, set next to what you like and what Zeff knows about you (your interests, the headlines
 * you gave a 👍, your facts, the people in your People plugin that it mentions, what your todos are about), and the AI says why
 * it matters to you and which searches would find more of it. Those searches go out to the internet (Google News and Bing News),
 * the answers are ranked by how close they are to the article and to you, the best ones become cards that open right below the
 * card — like a chip — and the feed finder looks for new sources around the topic and adds the best few. Without an AI the
 * article's own key terms are searched instead.
 */
export type SimilarResult = { ok: boolean; angle: string; queries: { q: string; why: string }[]; found: number; added: number; sourcesAdded: number; usedAi: boolean; error?: string };

type Plan = { angle?: string; queries?: { q?: string; why?: string }[]; keep?: string[]; avoid?: string[] };

const SCHEMA = {
  type: "object",
  properties: {
    angle: { type: "string", description: "Ein bis zwei Sätze: warum dieser Artikel für diese Person relevant ist — bezogen auf ihre Vorlieben, Personen und ihr Wissen." },
    queries: {
      type: "array",
      description: "3–5 Suchanfragen für eine Nachrichtensuche, die weitere passende Artikel finden (2–6 Wörter, konkrete Namen/Themen, verschiedene Blickwinkel).",
      items: { type: "object", properties: { q: { type: "string" }, why: { type: "string", description: "Kurz: was diese Suche findet." } }, required: ["q", "why"] },
    },
    keep: { type: "array", items: { type: "string" }, description: "Begriffe, die ein passender Treffer wahrscheinlich enthält." },
    avoid: { type: "array", items: { type: "string" }, description: "Begriffe, die auf einen unpassenden Treffer hindeuten." },
  },
  required: ["angle", "queries"],
};

export function similarPrompt(article: { title: string; text: string }, profile: string[]): string {
  return [
    "Du hilfst einer Person, mehr von dem zu finden, was sie liest. Sie hat bei diesem Artikel „Mehr davon“ gewählt.",
    "Lies den Artikel und setze ihn zu dem, was über die Person bekannt ist. Sage in ein bis zwei Sätzen, warum er für sie relevant ist (angle) — nur mit dem, was unten steht, nichts erfinden.",
    "Nenne dann 3–5 Suchanfragen für eine Nachrichtensuche, die weitere passende Artikel finden: konkrete Namen und Themen, verschiedene Blickwinkel (Hintergrund, Folgen, Gegenposition, Nachbarthemen), jeweils 2–6 Wörter.",
    "keep: Begriffe, die ein passender Treffer wahrscheinlich enthält. avoid: Begriffe, die auf einen unpassenden Treffer deuten.",
    "",
    `Artikel: ${article.title}`,
    article.text.slice(0, 2500),
    "",
    "Was über die Person bekannt ist:",
    ...(profile.length ? profile.map((p) => `- ${p}`) : ["- (nichts bekannt)"]),
  ].join("\n");
}

export type SimilarDeps = {
  /** The article as text (default: the kept text, else the page read now, else the summary). */
  read?: (id: number) => Promise<{ title: string; text: string; url: string }>;
  /** What is known about the person, as lines (default: interests, likes, facts, people, work). */
  profile?: (articleText: string) => Promise<string[]> | string[];
  ask?: (prompt: string) => Promise<Plan>;
  /** A search's answer (default: Google News and Bing News as RSS). */
  search?: (query: string) => Promise<FeedItem[]>;
  /** The feed finder (default: findFeeds). */
  find?: (query: string) => Promise<{ domain: string; feed: { url: string; title: string }; why: string }[]>;
  now?: () => number;
};

async function defaultRead(id: number): Promise<{ title: string; text: string; url: string }> {
  const item = getItem(id);
  if (!item) throw new Error("That item isn't there any more.");
  let text = getContent(id)?.content ?? "";
  if (text.length < 2) {
    try {
      text = (await fetchArticle(item.url)).text;
    } catch {
      text = item.summary;
    }
  }
  return { title: item.title, text: text.length > 1 ? text : item.summary, url: item.url };
}

/** Lines about the person: interests, what they liked, facts, the people they know that the article names, what they work on. */
export async function profileLines(articleText: string): Promise<string[]> {
  const prefs = getPrefs();
  const lines: string[] = [];
  if (prefs.interests.length) lines.push(`Interessen: ${prefs.interests.map((i) => (i.weight > 1 ? `${i.term} (wichtig)` : i.term)).join(", ")}`);
  const liked = learnedTop(10).map((l) => l.term);
  if (liked.length) lines.push(`Wofür sie 👍 gegeben hat: ${liked.join(", ")}`);
  if (prefs.mutes.length) lines.push(`Nicht interessiert an: ${prefs.mutes.join(", ")}`);
  try {
    const { listFacts } = await import("@/lib/facts");
    const facts = listFacts(30).slice(0, 12).map((f) => `${f.subject}: ${f.text}`.slice(0, 120));
    if (facts.length) lines.push(`Fakten über sie: ${facts.join(" | ")}`);
  } catch {
    // no facts
  }
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("people")) {
      const { listPeople } = await import("@/plugins/people/store");
      const low = articleText.toLowerCase();
      const people = listPeople();
      const named = people.filter((p) => [p.name, ...p.aliases].some((n) => n.length >= 4 && low.includes(n.toLowerCase())));
      for (const p of named.slice(0, 6)) lines.push(`Eine Person, die sie kennt und die im Artikel vorkommt: ${p.name}${p.note ? ` (${p.note.slice(0, 100)})` : ""}${p.compiled?.connection ? ` — ${p.compiled.connection.slice(0, 160)}` : ""}`);
      const close = people.filter((p) => p.starred && !named.includes(p)).slice(0, 5).map((p) => p.name);
      if (close.length) lines.push(`Ihr wichtige Personen: ${close.join(", ")}`);
    }
  } catch {
    // no people
  }
  try {
    const { workWords } = await import("./sync");
    const work = await workWords(10);
    if (work.length) lines.push(`Woran sie gerade arbeitet (aus offenen Todos): ${work.join(", ")}`);
  } catch {
    // no todos
  }
  return lines;
}

export async function defaultSearch(query: string): Promise<FeedItem[]> {
  const prefs = getPrefs();
  const urls = [topicFeedUrl(query, prefs.language, Math.max(3, prefs.maxAgeDays)), `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=${prefs.language === "en" ? "en-US" : "de-DE"}`];
  const out: FeedItem[] = [];
  await Promise.all(
    urls.map(async (u) => {
      try {
        const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (compatible; Zeff/1.0)" }, signal: AbortSignal.timeout(15000) });
        if (r.ok) out.push(...parseFeed(await decodeBody(r)).slice(0, 15));
      } catch {
        // that search didn't answer
      }
    }),
  );
  return out;
}

/** The article's own key terms as searches (no AI): its best tags, the first two together, then each. */
function termQueries(title: string, text: string): { q: string; why: string }[] {
  const a = analyze([{ id: 1, title, summary: text.slice(0, 400) }, { id: 2, title: "", summary: "" }]);
  const tags = (a.tags.get(1) ?? []).map((t) => t.name);
  const qs = [tags.slice(0, 2).join(" "), ...tags.slice(0, 3)].filter((q, i, all) => q && all.indexOf(q) === i);
  return qs.slice(0, 4).map((q) => ({ q, why: "Begriff aus dem Artikel" }));
}

export async function moreLikeThis(itemId: number, deps: SimilarDeps = {}): Promise<SimilarResult> {
  const fail = (error: string): SimilarResult => ({ ok: false, angle: "", queries: [], found: 0, added: 0, sourcesAdded: 0, usedAi: false, error });
  try {
    const article = await (deps.read ?? defaultRead)(itemId);
    const profile = await (deps.profile ?? profileLines)(`${article.title} ${article.text}`);
    // 1. The AI's reading (or the article's own terms).
    let plan: Plan = {};
    let usedAi = false;
    try {
      const ask =
        deps.ask ??
        (await (async () => {
          const { isInstalled } = await import("@/plugins/state");
          if (!isInstalled("llm")) return null;
          const { runAi } = await import("@/lib/ai");
          return async (prompt: string) => (await runAi<Plan>(prompt, SCHEMA, { task: "news-digest", timeoutMs: 3 * 60000, maxBudgetUsd: 0.3 })).output;
        })());
      if (ask) {
        plan = await ask(similarPrompt(article, profile));
        usedAi = !!plan.queries?.length;
      }
    } catch {
      plan = {};
    }
    const queries = (plan.queries ?? []).flatMap((x) => (x.q && x.q.trim().length >= 3 ? [{ q: x.q.trim().slice(0, 80), why: String(x.why ?? "").slice(0, 120) }] : [])).slice(0, 5);
    const useQueries = queries.length ? queries : termQueries(article.title, article.text);
    if (!useQueries.length) return fail("Nothing to search for in that article.");

    // 2. The internet: every search, the answers kept as items; what is already kept joins in.
    const search = deps.search ?? defaultSearch;
    const found = new Map<string, { item: FeedItem; q: string }>();
    await Promise.all(
      useQueries.map(async ({ q }) => {
        for (const it of await search(q).catch(() => [] as FeedItem[])) if (!found.has(it.url)) found.set(it.url, { item: it, q });
      }),
    );
    const own = getItem(itemId);
    const nowMs = (deps.now ?? Date.now)();
    const fresh = [...found.values()].filter((f) => nowMs - Date.parse(f.item.publishedAt) < getPrefs().maxAgeDays * 2 * 864e5 && f.item.url !== own?.url);
    let added = 0;
    for (const q of new Set(fresh.map((f) => f.q))) added += addItems({ id: null, name: `More like this: ${q}` }, fresh.filter((f) => f.q === q).map((f) => f.item));
    const local = useQueries.flatMap(({ q }) => searchItems(q, 8)).filter((i) => i.id !== itemId);

    // 3. Ranking: closeness to the article (TF-IDF cosine), words the AI expects, words that say "not it", and what you like.
    const candidates = new Map<string, { title: string; summary: string; url: string; q: string }>();
    for (const f of fresh) candidates.set(f.item.url, { title: f.item.title, summary: f.item.summary, url: f.item.url, q: f.q });
    for (const l of local) if (!candidates.has(l.url)) candidates.set(l.url, { title: l.title, summary: l.summary, url: l.url, q: "kept" });
    const list = [...candidates.values()];
    const docs = [{ id: -1, title: article.title, summary: article.text.slice(0, 700) }, ...list.map((c, i) => ({ id: i, title: c.title, summary: c.summary }))];
    const a = analyze(docs);
    const target = a.vectors.get(-1) ?? new Map();
    const lower = (s: string) => s.toLowerCase();
    const liked = new Set(learnedTop(12).map((l) => l.term.toLowerCase()));
    const interests = getPrefs().interests.map((i) => i.term.toLowerCase());
    const ranked = list
      .map((c, i) => {
        const text = lower(`${c.title} ${c.summary}`);
        let s = cosine(a.vectors.get(i) ?? new Map(), target);
        for (const k of plan.keep ?? []) if (k.length >= 3 && text.includes(lower(k))) s += 0.06;
        for (const k of plan.avoid ?? []) if (k.length >= 3 && text.includes(lower(k))) s -= 0.12;
        for (const w of liked) if (text.includes(w)) s += 0.03;
        for (const w of interests) if (w.length >= 3 && text.includes(w)) s += 0.05;
        return { ...c, s };
      })
      .sort((x, y) => y.s - x.s);
    const best = ranked.filter((r) => r.s > 0.04).slice(0, 25);
    const top = best.length >= 6 ? best : ranked.slice(0, 12);
    const ids = idsByUrls(top.map((t) => t.url));
    const entries = top.flatMap((t) => (ids.get(t.url) ? [{ id: ids.get(t.url)!, score: Math.max(0.001, t.s), why: t.q === "kept" ? "" : t.q }] : []));
    setSimilar(itemId, entries);
    setReasons(
      entries.map((e) => e.id),
      [`like: ${article.title.slice(0, 40)}`],
    );

    // 4. New sources around the topic (the feed finder), the best few added — the stream goes on after this card.
    let sourcesAdded = 0;
    try {
      const find =
        deps.find ??
        (async (q: string) => {
          const { findFeeds } = await import("./finder");
          const have = new Set(listSources().map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return ""; } }));
          return findFeeds(q, { have, profile: profile.slice(0, 6), language: getPrefs().language, limit: 4 });
        });
      const sug = await find(useQueries[0].q);
      sourcesAdded = addSources(sug.slice(0, 3).map((s) => ({ name: s.feed.title.slice(0, 80), url: s.feed.url, category: "Discovered", lang: getPrefs().language === "any" ? "" : getPrefs().language })));
    } catch {
      // finding sources is a bonus
    }
    return { ok: true, angle: String(plan.angle ?? "").slice(0, 400), queries: useQueries, found: entries.length, added, sourcesAdded, usedAi };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
