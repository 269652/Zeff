import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed, decodeEntities, feedTitle } from "@/plugins/news/feed";
import { formatInterests, normalizeUrl, parseInterests, parseMutes, scoreItem, titleKey, topicFeedUrl, type ScoreContext } from "@/plugins/news/shared";
import { setupTempData } from "./helpers";

setupTempData();

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Mein Feed</title>
<image><title>Logo</title></image>
<item><title><![CDATA[Neue KI-Regeln &amp; Folgen]]></title><link>https://example.com/a?utm_source=x</link><guid>a-1</guid><pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Die EU <b>beschließt</b> Regeln f&#252;r KI.</p>]]></description></item>
<item><title>Ohne Link</title></item>
<item><title>Kaputtes Datum</title><link>https://example.com/b</link><pubDate>gestern</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title><entry><title>Atom Story</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/atom-1"/><id>tag:1</id><updated>2026-10-12T09:30:00Z</updated><summary type="html">&lt;p&gt;Kurztext&lt;/p&gt;</summary></entry></feed>`;
const NOW = Date.parse("2026-10-12T12:00:00Z");

test("RSS and Atom feeds become items: CDATA, entities and HTML decoded, the alternate link taken, nonsense dropped", () => {
  const items = parseFeed(RSS, "2026-10-12T10:00:00.000Z");
  assert.equal(items.length, 2, "the one without a link is dropped");
  const a = items.find((i) => i.guid === "a-1")!;
  assert.equal(a.title, "Neue KI-Regeln & Folgen");
  assert.equal(a.summary, "Die EU beschließt Regeln für KI.");
  assert.equal(a.publishedAt, "2026-10-12T08:00:00.000Z");
  assert.equal(items.find((i) => i.url.endsWith("/b"))!.publishedAt, "2026-10-12T10:00:00.000Z", "a date that is none: when it was fetched");
  const atom = parseFeed(ATOM);
  assert.equal(atom[0].url, "https://example.com/atom-1");
  assert.equal(atom[0].summary, "Kurztext");
  assert.equal(atom[0].publishedAt, "2026-10-12T09:30:00.000Z");
  assert.equal(feedTitle(RSS), "Mein Feed");
  assert.equal(decodeEntities("a &amp; b &#x41; &auml; &unknown;"), "a & b A ä &unknown;");
});

test("the same article under two links, or the same headline from two sources, is one", () => {
  assert.equal(normalizeUrl("https://www.Example.com/a/?utm_source=x&b=1&fbclid=z#top"), "https://example.com/a?b=1");
  assert.equal(titleKey("Neue KI-Regeln – Spiegel"), titleKey("Neue KI-Regeln"));
});

test("interests and mutes are written plainly: one per line, a trailing x2 is the weight", () => {
  const list = parseInterests("TypeScript x3\nFormel 1\nKI ×2, Formel 1\nx");
  assert.deepEqual(list, [{ term: "TypeScript", weight: 3 }, { term: "Formel 1", weight: 1 }, { term: "KI", weight: 2 }]);
  assert.deepEqual(parseInterests(formatInterests(list)), list);
  assert.deepEqual(parseMutes("Promi, Horoskop\nPromi"), ["Promi", "Horoskop"]);
  assert.match(topicFeedUrl("Formel 1", "de", 7), /news\.google\.com\/rss\/search\?q=Formel%201%20when%3A7d&hl=de&gl=DE/);
});

const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({ prefs: { interests: [], mutes: [] }, learned: new Map(), work: [], sourceWeight: 1, sourceVotes: 0, now: NOW, ...over });
const item = (title: string, summary = "", at = "2026-10-12T11:00:00Z") => ({ title, summary, publishedAt: at });

test("scoring: interests (in the headline more than in the text, with their weight), muted words out, short terms as whole words", () => {
  const prefs = { interests: [{ term: "KI", weight: 2 }, { term: "Rust", weight: 1 }], mutes: ["Horoskop"] };
  const inTitle = scoreItem(item("KI schreibt Code"), ctx({ prefs }));
  const inText = scoreItem(item("Neues aus der Technik", "Eine KI hilft"), ctx({ prefs }));
  const none = scoreItem(item("Wetter morgen"), ctx({ prefs }));
  assert.ok(inTitle.score > inText.score && inText.score > none.score);
  assert.ok(inTitle.reasons.includes("KI ×2"));
  assert.equal(scoreItem(item("Horoskop für KI-Fans"), ctx({ prefs })).score, -100, "muted beats everything");
  assert.ok(scoreItem(item("Kiosk eröffnet"), ctx({ prefs })).score < inText.score, "KI is not in 'Kiosk'");
});

test("scoring: fresh beats old, a trusted source lifts the good, what you liked before counts, your work counts", () => {
  const prefs = { interests: [{ term: "Rust", weight: 1 }], mutes: [] };
  const fresh = scoreItem(item("Rust 2.0", "", "2026-10-12T11:30:00Z"), ctx({ prefs }));
  const old = scoreItem(item("Rust 2.0", "", "2026-10-09T11:30:00Z"), ctx({ prefs }));
  assert.ok(fresh.score > old.score);
  const trusted = scoreItem(item("Rust 2.0"), ctx({ prefs, sourceWeight: 2 }));
  assert.ok(trusted.score > scoreItem(item("Rust 2.0"), ctx({ prefs })).score);
  assert.ok(scoreItem(item("Irgendwas"), ctx({ sourceWeight: 2 })).score <= scoreItem(item("Irgendwas"), ctx()).score + 0.001, "a trusted source doesn't lift what isn't good");
  const learned = new Map([["batterie", 2]]);
  const liked = scoreItem(item("Neue Batterie vorgestellt"), ctx({ learned }));
  assert.ok(liked.score > scoreItem(item("Neue Brücke vorgestellt"), ctx({ learned })).score);
  assert.ok(liked.reasons.some((r) => r.startsWith("like")));
  const work = scoreItem(item("Migration der Datenbank", "Postgres"), ctx({ work: ["migration"] }));
  assert.ok(work.reasons.some((r) => r.startsWith("work")));
});

test("the store: new items are kept once; liking teaches the words and the source; hidden and muted stay out of For you", async () => {
  const s = await import("@/plugins/news/store");
  const src = s.addSource({ name: "Test", url: "https://example.com/feed.xml" });
  assert.equal(s.addSource({ name: "Again", url: "https://example.com/feed.xml" }).id, src.id, "the same address is one source");
  assert.throws(() => s.addSource({ name: "x", url: "ftp://nope" }), /http/);
  const base = { guid: "g", summary: "", publishedAt: new Date().toISOString() };
  const added = s.addItems({ id: src.id, name: "Test" }, [
    { ...base, guid: "1", url: "https://example.com/1?utm_source=a", title: "Neue Batterie für Elektroautos vorgestellt" },
    { ...base, guid: "2", url: "https://example.com/2", title: "Promi-Horoskop der Woche" },
    { ...base, guid: "3", url: "https://example.com/3", title: "Bundestag debattiert Haushalt" },
  ]);
  assert.equal(added, 3);
  assert.equal(s.addItems({ id: src.id, name: "Test" }, [{ ...base, guid: "1b", url: "https://example.com/1", title: "Etwas anderes" }, { ...base, guid: "x", url: "https://other.com/x", title: "Neue Batterie für Elektroautos vorgestellt" }]), 0, "same link, same headline");

  s.setPrefs({ interests: [{ term: "Elektroauto", weight: 2 }], mutes: ["Horoskop"], useWork: false });
  const rescore = () => s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: s.listSources()[0].votes }));
  rescore();
  const top = s.listItems({ view: "foryou" });
  assert.equal(top[0].title, "Neue Batterie für Elektroautos vorgestellt");
  assert.ok(!top.some((i) => /Horoskop/.test(i.title)), "muted");

  // A like teaches the headline's words and the source; a dislike the opposite.
  const bundestag = top.find((i) => /Bundestag/.test(i.title))!;
  s.vote(top[0].id, 1);
  s.vote(bundestag.id, -1);
  assert.equal(s.listSources()[0].votes, 0);
  s.vote(top[0].id, 1); // the same vote again changes nothing
  assert.equal(s.getItem(top[0].id)!.vote, 1);
  const learned = s.learnedTerms();
  assert.ok((learned.get("batterie") ?? 0) > 0 && (learned.get("bundestag") ?? 0) < 0);
  s.vote(top[0].id, 0);
  assert.equal(s.learnedTerms().get("batterie") ?? 0, 0, "taking the like back takes the learning back");

  s.setState(bundestag.id, "hidden");
  assert.ok(!s.listItems({ view: "foryou" }).some((i) => i.id === bundestag.id));
  assert.equal(s.listItems({ view: "hidden" })[0].id, bundestag.id);
  s.setState(top[0].id, "saved");
  assert.equal(s.prune(0), 2, "saved ones stay, the rest of the old goes");
  assert.equal(s.listItems({ view: "saved" }).length, 1);
  assert.equal(s.counts().saved, 1);
});

test("the sync fetches sources and an interest search each, keeps what is recent, scores it, and says which source failed", async () => {
  const s = await import("@/plugins/news/store");
  const { syncNews } = await import("@/plugins/news/sync");
  for (const x of s.listSources()) s.removeSource(x.id);
  const good = s.addSource({ name: "Gut", url: "https://good.example/rss" });
  s.addSource({ name: "Kaputt", url: "https://bad.example/rss" });
  s.setPrefs({ interests: [{ term: "Klimaschutz", weight: 3 }], mutes: [], topicSearch: true, useWork: false, digest: false, maxAgeDays: 7 });
  const asked: string[] = [];
  const day = (d: number) => new Date(NOW - d * 864e5).toUTCString();
  const feed = (titles: [string, number][]) => `<rss><channel>${titles.map(([t, d], i) => `<item><title>${t}</title><link>https://x.example/${encodeURIComponent(t)}${i}</link><pubDate>${day(d)}</pubDate></item>`).join("")}</channel></rss>`;
  const r = await syncNews({
    now: () => NOW,
    fetchText: async (url) => {
      asked.push(url);
      if (url.startsWith("https://bad.example")) throw new Error("HTTP 500");
      if (url.includes("news.google.com")) return feed([["Klimaschutz: neues Gesetz", 0.1]]);
      return feed([["Fußball: Spieltag", 0.2], ["Uralt-Meldung", 30]]);
    },
  });
  assert.equal(r.ok, true);
  assert.match(r.message, /2 new from 2 of 3 sources/);
  assert.match(r.message, /Kaputt: HTTP 500/);
  assert.ok(asked.some((u) => u.includes("Klimaschutz")), "one search per interest");
  const titles = s.listItems({ view: "foryou" }).map((i) => i.title);
  assert.equal(titles[0], "Klimaschutz: neues Gesetz", "the interest first");
  assert.ok(!titles.includes("Uralt-Meldung"), "too old isn't kept");
  assert.equal(s.listSources().find((x) => x.name === "Kaputt")!.lastError, "HTTP 500");
  assert.equal(s.listSources().find((x) => x.id === good.id)!.lastError, null);
  // Nothing to fetch: a clear message, not an error.
  for (const x of s.listSources()) s.removeSource(x.id);
  s.setPrefs({ interests: [] });
  assert.match((await syncNews({ now: () => NOW, fetchText: async () => "" })).message, /No sources and no interests/);
});

test("the AI overview: the best unread items go in, its picks are kept with their reason; with nothing unread there is none", async () => {
  const s = await import("@/plugins/news/store");
  const { buildDigest, getDigest, digestPrompt } = await import("@/plugins/news/digest");
  const src = s.addSource({ name: "D", url: "https://d.example/rss" });
  s.setPrefs({ interests: [{ term: "Chips", weight: 2 }], mutes: [], useWork: false });
  s.addItems({ id: src.id, name: "D" }, [
    { guid: "d1", url: "https://d.example/1", title: "Neue Chips von Intel", summary: "Mehr Takt", publishedAt: new Date().toISOString() },
    { guid: "d2", url: "https://d.example/2", title: "Sommerwetter bleibt", summary: "", publishedAt: new Date().toISOString() },
  ]);
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));
  let prompt = "";
  const d = await buildDigest({
    ask: async (p) => ((prompt = p), { overview: "Heute: neue Chips.", picks: [{ n: 1, why: "Du liest über Chips." }, { n: 9, why: "gibt es nicht" }] }),
  });
  assert.match(prompt, /Interessen: Chips/);
  assert.match(prompt, /1\. \[D\] Neue Chips von Intel/);
  assert.equal(d!.picks.length, 1, "a pick of a number that isn't there is dropped");
  assert.equal(getDigest()!.overview, "Heute: neue Chips.");
  assert.match(digestPrompt([], [{ n: 1, source: "x", title: "t", summary: "" }]), /\(keine angegeben\)/);
  for (const it of s.listItems({ view: "latest" })) s.setState(it.id, "read");
  assert.equal(await buildDigest({ ask: async () => ({ overview: "x", picks: [] }) }), null);
});
