import { getPref, setPref } from "@/lib/prefs";
import type { FeedItem } from "./feed";
import { retagAll } from "./retag";
import { addItems, addSources, getPrefs, listSources, setSimilar, unreadForMatching } from "./store";
import { getTaste, matchTaste, seedFromHistory, tasteReady, updateTaste, type Taste, type TasteDeps } from "./taste";
import { syncNews, type NewsSyncDeps } from "./sync";

/**
 * Discover: from the written description of your taste —
 *   1. it is brought up to date (the likes and saves not yet taken in go through the AI first);
 *   2. the AI plans searches from it (varied, with a few neighbouring topics, none you had last time);
 *   3. the internet is searched (Google News, Bing News) and the answers kept as items;
 *   4. the feed finder looks for new sources around the best searches, the best few are added and fetched at once;
 *   5. everything unread that is already fetched — old and new — is matched against the description and the best become the
 *      "Discover" view of the feed.
 * It runs in the background and reports where it is.
 */
export type DiscoverStatus = { running: boolean; phase: string; web: number; sourcesAdded: number; matched: number; startedAt: string | null; finishedAt: string | null; message: string };

const g = globalThis as { __zeffNewsDiscover?: DiscoverStatus };
const idle = (): DiscoverStatus => ({ running: false, phase: "", web: 0, sourcesAdded: 0, matched: 0, startedAt: null, finishedAt: null, message: "" });
export const getDiscoverStatus = (): DiscoverStatus => g.__zeffNewsDiscover ?? idle();
const set = (p: Partial<DiscoverStatus>) => (g.__zeffNewsDiscover = { ...getDiscoverStatus(), ...p });

type Plan = { queries?: string[] };
const SCHEMA = { type: "object", properties: { queries: { type: "array", items: { type: "string" }, description: "10–12 Suchanfragen (2–5 Wörter, deutsch und englisch gemischt) für eine Nachrichtensuche: die Hauptthemen und 2–3 Nachbarthemen, die überraschen dürfen." } }, required: ["queries"] };

export function planPrompt(taste: Pick<Taste, "text" | "likes" | "avoids">, interests: string[], recent: string[]): string {
  return [
    "Du planst die Suche nach neuen Nachrichten für eine Person. Unten steht eine Beschreibung ihres Nachrichten-Geschmacks.",
    "Gib 10–12 konkrete Suchanfragen (2–5 Wörter, gern englisch, wenn sie englische Quellen mag) für eine Nachrichtensuche — nach Forschung und Berichten, nie nach Produkten, Shopping oder Werbung: die Hauptthemen aus verschiedenen Blickwinkeln und 2–3 Nachbarthemen, die sie überraschen und trotzdem interessieren könnten. Keine Anfragen, die schon zu den letzten gehörten.",
    "",
    `Beschreibung: ${taste.text || "(noch keine)"}`,
    `Mag: ${taste.likes.join(", ") || "-"}; ausdrückliche Interessen: ${interests.join(", ") || "-"}`,
    `Meidet: ${taste.avoids.join(", ") || "-"}`,
    `Letzte Suchen (nicht wiederholen): ${recent.join(" | ") || "-"}`,
  ].join("\n");
}

export type DiscoverDeps = {
  taste?: TasteDeps;
  ask?: (prompt: string) => Promise<Plan>;
  search?: (query: string) => Promise<FeedItem[]>;
  find?: (query: string) => Promise<{ domain: string; feed: { url: string; title: string }; why: string }[]>;
  sync?: (deps: NewsSyncDeps) => Promise<{ ok: boolean; message: string }>;
};

export function startDiscover(deps: DiscoverDeps = {}): { status: DiscoverStatus; promise: Promise<DiscoverStatus> } {
  if (getDiscoverStatus().running) return { status: getDiscoverStatus(), promise: Promise.resolve(getDiscoverStatus()) };
  set({ ...idle(), running: true, phase: "Reading your taste …", startedAt: new Date().toISOString() });
  const promise = run(deps).catch((e) => set({ running: false, phase: "", finishedAt: new Date().toISOString(), message: `Failed: ${e instanceof Error ? e.message : String(e)}` }));
  return { status: getDiscoverStatus(), promise };
}

async function run(deps: DiscoverDeps): Promise<DiscoverStatus> {
  const prefs = getPrefs();
  // 1. The description, up to date.
  seedFromHistory();
  if (getTaste().pending.length) await updateTaste(deps.taste);
  if (!tasteReady()) return set({ running: false, phase: "", finishedAt: new Date().toISOString(), message: "Like or save a few articles first (or name interests in the settings) — Discover works from what you like." });
  const taste = getTaste();
  const interests = prefs.interests.map((i) => i.term);

  // 2. Searches.
  set({ phase: "Planning searches …" });
  const recent = getPref<string[]>("news:discover-queries", []);
  let queries: string[] = [];
  try {
    const ask =
      deps.ask ??
      (await (async () => {
        const { isInstalled } = await import("@/plugins/state");
        if (!isInstalled("llm")) return null;
        const { runAi } = await import("@/lib/ai");
        return async (prompt: string) => (await runAi<Plan>(prompt, SCHEMA, { task: "news-digest", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output;
      })());
    if (ask) queries = ((await ask(planPrompt(taste, interests, recent))).queries ?? []).map((q) => String(q).trim()).filter((q) => q.length >= 3 && q.length <= 80);
  } catch {
    queries = [];
  }
  if (!queries.length) queries = [...new Set([...taste.queries, ...taste.likes.slice(0, 5), ...interests])].filter((q) => !recent.includes(q)).slice(0, 12);
  queries = [...new Set(queries)].slice(0, 12);
  setPref("news:discover-queries", [...queries, ...recent].slice(0, 30));

  // 3. The web.
  set({ phase: "Searching the web …" });
  const langs = [...new Set(["en", prefs.language === "any" ? "de" : prefs.language])];
  const search = deps.search ?? ((q: string) => import("./similar").then((m) => m.defaultSearch(q, langs)));
  let web = 0;
  const cutoff = Date.now() - prefs.maxAgeDays * 3 * 864e5;
  await Promise.all(
    queries.map(async (q) => {
      const items = (await search(q).catch(() => [] as FeedItem[])).filter((it) => Date.parse(it.publishedAt) >= cutoff);
      web += addItems({ id: null, name: `Discover: ${q}` }, items);
    }),
  );
  set({ web });

  // 4. New sources around the best searches, fetched at once.
  set({ phase: "Finding new sources …" });
  let sourcesAdded = 0;
  const before = new Set(listSources().map((s) => s.id));
  try {
    const find =
      deps.find ??
      (async (q: string) => {
        const { findFeeds } = await import("./finder");
        const have = new Set(listSources().map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return ""; } }));
        return findFeeds(q, { have, profile: taste.likes.slice(0, 6), language: prefs.language, limit: 4 });
      });
    for (const q of queries.slice(0, 6)) {
      const sug = await find(q).catch(() => []);
      sourcesAdded += addSources(sug.slice(0, 3).map((s) => ({ name: s.feed.title.slice(0, 80), url: s.feed.url, category: "Discovered", lang: prefs.language === "any" ? "" : prefs.language })));
    }
  } catch {
    // finding sources is a bonus
  }
  set({ sourcesAdded });
  const fresh = listSources().filter((s) => !before.has(s.id)).map((s) => s.id);
  if (fresh.length) {
    set({ phase: `Fetching ${fresh.length} new sources …` });
    await (deps.sync ?? syncNews)({ onlyIds: fresh, noLow: true, discoverFeeds: async () => 0, discoverWhenLow: async () => 0, aiTags: async () => undefined });
  }

  // 5. Matching: everything unread against the description.
  set({ phase: "Matching your unread news …" });
  try {
    retagAll();
  } catch {
    // tags are a bonus
  }
  const scored = matchTaste(taste, unreadForMatching(Math.max(prefs.maxAgeDays, 7)));
  // Relative to the best match (a long description is only ever a little "close" to a short headline): the better part of the field, 40–150 cards.
  const top = scored[0]?.score ?? 0;
  const floor = Math.max(0.015, top * 0.3);
  const keep = scored.filter((x, i) => x.score > 0 && (x.score >= floor || i < 40)).slice(0, 150);
  setSimilar(-1, keep.map((s) => ({ id: s.id, score: Math.max(0.001, s.score), why: "" })));
  return set({
    running: false,
    phase: "",
    matched: keep.length,
    finishedAt: new Date().toISOString(),
    message: `${keep.length} matching cards${sourcesAdded ? `, ${sourcesAdded} new sources` : ""}${web ? `, ${web} found on the web` : ""}`,
  });
}
