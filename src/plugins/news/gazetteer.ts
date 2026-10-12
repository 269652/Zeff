/**
 * Things a headline reliably means when it names them: countries, regions, big organisations, companies, a few products and
 * people-in-the-news — German and English spellings, the canonical name first. Not a knowledge base; a prior that lifts
 * known names above capitalised common nouns (every German noun is capitalised, which is what makes names hard to spot).
 */
export type Kind = "place" | "org" | "company" | "person" | "topic";

const rows: [Kind, string, ...string[]][] = [
  // Countries and regions
  ["place", "Deutschland", "Germany", "German", "Bundesrepublik"], ["place", "USA", "United States", "US", "Vereinigte Staaten", "America", "Amerika"], ["place", "China", "Chinese", "Chinas"],
  ["place", "Russland", "Russia", "Russian", "Russlands"], ["place", "Ukraine", "Ukrainian", "Ukraines"], ["place", "Israel", "Israeli"], ["place", "Gaza"], ["place", "Iran"], ["place", "Irak", "Iraq"],
  ["place", "Syrien", "Syria"], ["place", "Türkei", "Turkey", "Türkiye"], ["place", "Indien", "India"], ["place", "Japan"], ["place", "Südkorea", "South Korea"], ["place", "Nordkorea", "North Korea"],
  ["place", "Taiwan"], ["place", "Frankreich", "France"], ["place", "Italien", "Italy"], ["place", "Spanien", "Spain"], ["place", "Großbritannien", "Britain", "United Kingdom", "UK", "England"],
  ["place", "Polen", "Poland"], ["place", "Österreich", "Austria"], ["place", "Schweiz", "Switzerland"], ["place", "Niederlande", "Netherlands"], ["place", "Brasilien", "Brazil"],
  ["place", "Mexiko", "Mexico"], ["place", "Kanada", "Canada"], ["place", "Australien", "Australia"], ["place", "Afrika", "Africa"], ["place", "Europa", "Europe"], ["place", "Asien", "Asia"],
  ["place", "Nahost", "Middle East", "Naher Osten"], ["place", "Venezuela"], ["place", "Argentinien", "Argentina"], ["place", "Ägypten", "Egypt"], ["place", "Saudi-Arabien", "Saudi Arabia"],
  ["place", "Berlin"], ["place", "München", "Munich"], ["place", "Hamburg"], ["place", "Brüssel", "Brussels"], ["place", "Washington"], ["place", "London"], ["place", "Paris"], ["place", "Moskau", "Moscow"],
  ["place", "Peking", "Beijing"], ["place", "Kiew", "Kyiv", "Kiev"], ["place", "Jerusalem"], ["place", "Wien", "Vienna"], ["place", "Zürich", "Zurich"], ["place", "New York"], ["place", "Silicon Valley"],
  // Organisations
  ["org", "EU", "Europäische Union", "European Union"], ["org", "NATO", "Nato"], ["org", "UN", "UNO", "Vereinte Nationen", "United Nations"], ["org", "WHO", "Weltgesundheitsorganisation"],
  ["org", "Bundesregierung"], ["org", "Bundestag"], ["org", "Bundesrat"], ["org", "Bundesverfassungsgericht"], ["org", "EZB", "ECB", "Europäische Zentralbank"], ["org", "Fed", "Federal Reserve"],
  ["org", "IWF", "IMF"], ["org", "OPEC"], ["org", "WTO"], ["org", "G7"], ["org", "G20"], ["org", "NASA"], ["org", "ESA"], ["org", "CDU"], ["org", "CSU"], ["org", "SPD"], ["org", "FDP"], ["org", "AfD"],
  ["org", "Grüne", "Greens"], ["org", "Linke"], ["org", "BSW"], ["org", "Hamas"], ["org", "Hisbollah", "Hezbollah"], ["org", "Taliban"], ["org", "Kreml", "Kremlin"], ["org", "Pentagon"], ["org", "FBI"], ["org", "CIA"],
  ["org", "Deutsche Bahn", "Bahn"], ["org", "Bundeswehr"], ["org", "Europäisches Parlament", "European Parliament"], ["org", "EU-Kommission", "European Commission"], ["org", "Weißes Haus", "White House"],
  ["org", "Bundesliga"], ["org", "Premier League"], ["org", "Champions League"], ["org", "FIFA"], ["org", "UEFA"], ["org", "IOC"], ["org", "Formel 1", "Formula 1", "F1"], ["org", "NBA"], ["org", "NFL"],
  // Companies and products
  ["company", "Apple"], ["company", "Google", "Alphabet"], ["company", "Microsoft"], ["company", "Amazon"], ["company", "Meta", "Facebook"], ["company", "Tesla"], ["company", "Nvidia"], ["company", "OpenAI"],
  ["company", "Anthropic"], ["company", "Samsung"], ["company", "Intel"], ["company", "AMD"], ["company", "TSMC"], ["company", "IBM"], ["company", "Oracle"], ["company", "SAP"], ["company", "Siemens"],
  ["company", "Volkswagen", "VW"], ["company", "BMW"], ["company", "Mercedes", "Mercedes-Benz", "Daimler"], ["company", "Porsche"], ["company", "Audi"], ["company", "Bosch"], ["company", "BASF"], ["company", "Bayer"],
  ["company", "Lufthansa"], ["company", "Telekom", "Deutsche Telekom"], ["company", "Deutsche Bank"], ["company", "Commerzbank"], ["company", "Allianz"], ["company", "Adidas"], ["company", "Netflix"], ["company", "Spotify"],
  ["company", "X", "Twitter"], ["company", "TikTok"], ["company", "Instagram"], ["company", "WhatsApp"], ["company", "YouTube"], ["company", "Uber"], ["company", "Airbnb"], ["company", "SpaceX"], ["company", "Starlink"],
  ["company", "Boeing"], ["company", "Airbus"], ["company", "Shell"], ["company", "Rheinmetall"], ["company", "Huawei"], ["company", "Xiaomi"], ["company", "ByteDance"], ["company", "Alibaba"], ["company", "Tencent"],
  ["company", "ChatGPT"], ["company", "Gemini"], ["company", "Claude"], ["company", "Copilot"], ["company", "iPhone"], ["company", "Android"], ["company", "Windows"], ["company", "Linux"], ["company", "GitHub"],
  // People in the news
  ["person", "Donald Trump", "Trump"], ["person", "Joe Biden", "Biden"], ["person", "Kamala Harris", "Harris"], ["person", "Wladimir Putin", "Vladimir Putin", "Putin"], ["person", "Wolodymyr Selenskyj", "Volodymyr Zelensky", "Selenskyj", "Zelensky", "Zelenskyy", "Zelenskiy"],
  ["person", "Olaf Scholz", "Scholz"], ["person", "Friedrich Merz", "Merz"], ["person", "Robert Habeck", "Habeck"], ["person", "Annalena Baerbock", "Baerbock"], ["person", "Christian Lindner", "Lindner"],
  ["person", "Alice Weidel", "Weidel"], ["person", "Emmanuel Macron", "Macron"], ["person", "Xi Jinping", "Xi"], ["person", "Benjamin Netanjahu", "Benjamin Netanyahu", "Netanjahu", "Netanyahu"],
  ["person", "Ursula von der Leyen", "von der Leyen"], ["person", "Elon Musk", "Musk"], ["person", "Sam Altman", "Altman"], ["person", "Mark Zuckerberg", "Zuckerberg"], ["person", "Jeff Bezos", "Bezos"],
  ["person", "Tim Cook"], ["person", "Satya Nadella", "Nadella"], ["person", "Jensen Huang"], ["person", "Papst Franziskus", "Pope Francis"], ["person", "König Charles", "King Charles"],
  // Topics (evergreen)
  ["topic", "Künstliche Intelligenz", "KI", "AI", "Artificial Intelligence"], ["topic", "Klimawandel", "Klimakrise", "Klimaschutz", "Climate Change", "Climate"], ["topic", "Inflation"], ["topic", "Rezession", "Recession"],
  ["topic", "Cyberangriff", "Cyberattack", "Cyber attack", "Cyber-attack", "Hackerangriff", "Cyber-Angriff"], ["topic", "Datenschutz", "Privacy"], ["topic", "Quantencomputer", "Quantum Computing"], ["topic", "Elektroauto", "Electric Vehicle", "EV"],
  ["topic", "Wahl", "Election"], ["topic", "Krieg", "War"], ["topic", "Streik"], ["topic", "Migration", "Immigration"], ["topic", "Energiewende"], ["topic", "Rente", "Pension"], ["topic", "Bitcoin"], ["topic", "Krypto", "Crypto"],
];

import { TOPICS } from "./topics";

// The topic packs' topics are topics a headline can be about, too: German name canonical, the English one an alias.
for (const t of TOPICS) {
  const de = t.de;
  if (de.length < 5 || de === "Geschichte") continue; // ("Geschichte" is also "story" in every other headline)
  rows.push(["topic", de, t.en]);
}

export type Entry = { name: string; kind: Kind };
/** A spelling (lower-case) → the canonical entry. */
export const GAZETTEER: Map<string, Entry> = (() => {
  const m = new Map<string, Entry>();
  for (const [kind, name, ...aliases] of rows) for (const a of [name, ...aliases]) if (!m.has(a.toLowerCase())) m.set(a.toLowerCase(), { name, kind });
  return m;
})();

/** The longest gazetteer phrase length in words (for the scan). */
export const GAZETTEER_MAX_WORDS = Math.max(...[...GAZETTEER.keys()].map((k) => k.split(" ").length));

/** The spellings exactly as listed (short aliases like "US", "EU", "KI" must be written so to count). */
export const GAZETTEER_EXACT: Set<string> = new Set(rows.flatMap(([, name, ...aliases]) => [name, ...aliases]));
