import { CATALOG, type CatalogFeed } from "./catalog-data";
import { topicFeeds } from "./topics";

/**
 * The stock catalog as the settings page and the sync use it: grouped by category, with the starter pack —
 * the feeds that are on right after you pick "Starter pack". The feeds themselves are in catalog-data.ts
 * (generated and checked against the live internet by scripts/news-catalog.mts).
 */
export { CATALOG, type CatalogFeed };

/** Everything on offer: the checked outlets and the generated topic packs. */
export const ALL_FEEDS: CatalogFeed[] = [...new Map([...CATALOG, ...topicFeeds()].map((f) => [f.url, f])).values()];

/** The categories in the order they are shown, with their names (translated where shown). */
export const CATEGORY_ORDER = ["World", "Tech", "Science", "Business", "Culture", "Gaming", "Sport", "Lifestyle", "Community", "Google", "Topics"] as const;

export const LANGUAGES: Record<string, string> = { de: "Deutsch", en: "English", es: "Español", fr: "Français", it: "Italiano" };

/** A pick of the best-known, reliable feeds across topics and languages: what "Starter pack" switches on. */
export const STARTER_NAMES = [
  "Tagesschau", "Spiegel Schlagzeilen", "ZEIT ONLINE", "FAZ Aktuell", "Süddeutsche Zeitung", "Deutschlandfunk Nachrichten", "DW Deutsch",
  "heise online", "Golem.de", "t3n", "netzpolitik.org", "ComputerBase",
  "BBC World", "Guardian World", "NPR News", "Al Jazeera", "NYT World", "Politico",
  "Ars Technica", "The Verge", "WIRED", "TechCrunch", "Hacker News Front Page", "MIT Technology Review", "Lobsters",
  "Quanta Magazine", "Nature", "Science Daily", "Phys.org", "Scientific American", "Space.com",
  "Spiegel Wissenschaft", "Spektrum.de", "Carbon Brief", "The Economist Leaders", "CNBC Top News",
  "Kicker Bundesliga", "BBC Sport", "Dezeen", "Open Culture", "Atlas Obscura", "Our World in Data", "The Conversation",
  "El País", "BBC Mundo",
];

export const categoriesOf = (feeds: CatalogFeed[] = ALL_FEEDS): { category: string; count: number }[] => {
  const count = new Map<string, number>();
  for (const f of feeds) count.set(f.category, (count.get(f.category) ?? 0) + 1);
  const known = CATEGORY_ORDER.filter((c) => count.has(c)).map((category) => ({ category, count: count.get(category)! }));
  const other = [...count].filter(([c]) => !(CATEGORY_ORDER as readonly string[]).includes(c)).map(([category, n]) => ({ category, count: n }));
  return [...known, ...other];
};

export const starterFeeds = (feeds: CatalogFeed[] = ALL_FEEDS): CatalogFeed[] => feeds.filter((f) => STARTER_NAMES.includes(f.name));
