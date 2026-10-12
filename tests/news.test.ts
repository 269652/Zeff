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

const LONG = "Absatz mit genug Text, damit er als Artikeltext zählt und nicht als Beiwerk. ".repeat(3);

test("feeds bring their pictures (media, enclosure, the first <img>) and, when they carry it, the whole article", async () => {
  const { parseFeed } = await import("@/plugins/news/feed");
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>A</title><link>https://x.example/a</link><media:thumbnail url="https://img.example/a.jpg"/></item>
<item><title>B</title><link>https://x.example/b</link><enclosure url="https://img.example/b.png" type="image/png" length="1"/><enclosure url="https://x.example/b.mp3" type="audio/mpeg" length="1"/></item>
<item><title>C</title><link>https://x.example/c</link><description><![CDATA[<p><img src="/pics/c.jpg"> Text</p>]]></description></item>
<item><title>D</title><link>https://x.example/d</link><content:encoded><![CDATA[<p>${LONG.repeat(3)}</p><p>Zweiter Absatz.</p>]]></content:encoded></item>
<item><title>E</title><link>https://x.example/e</link><media:content url="javascript:alert(1)" medium="image"/></item></channel></rss>`;
  const by = Object.fromEntries(parseFeed(xml).map((i) => [i.title, i]));
  assert.equal(by.A.image, "https://img.example/a.jpg");
  assert.equal(by.B.image, "https://img.example/b.png");
  assert.equal(by.C.image, undefined, "a relative picture has no base to be relative to here — only absolute ones are kept");
  assert.match(by.D.content ?? "", /Absatz mit genug Text[\s\S]*\n\nZweiter Absatz\./);
  assert.equal(by.E.image, undefined, "no script addresses");
});

const PAGE = `<html><head><title>Titel - Seite</title><meta property="og:image" content="/media/hero.jpg"><meta property="og:description" content="Kurzfassung"></head><body>
<header><p>Menü Menü Menü Menü Menü Menü Menü Menü Menü Menü</p></header><nav><p>Navigation Navigation Navigation Navigation Navigation</p></nav>
<article><h2>Zwischenüberschrift</h2><p>${LONG}</p><p>Wir verwenden Cookies, um Ihnen das beste Erlebnis zu bieten.</p><p>Zweiter echter Absatz mit ausreichend Länge für den Artikel hier.</p><p>kurz</p></article>
<footer><p>Impressum und alle Rechte vorbehalten für diese Seite hier unten.</p></footer><script>var x = "<p>nicht lesen nicht lesen nicht lesen nicht lesen</p>"</script></body></html>`;

test("the reader takes the article's paragraphs out of a page — no menus, scripts, cookie banners — and its picture", async () => {
  const { extractArticle, fetchArticle } = await import("@/plugins/news/reader");
  const a = extractArticle(PAGE, "https://site.example/news/1");
  assert.match(a.text, /Zwischenüberschrift\n\nAbsatz mit genug Text/);
  assert.match(a.text, /Zweiter echter Absatz/);
  assert.doesNotMatch(a.text, /Menü|Navigation|Cookies|Impressum|nicht lesen|^kurz$/m);
  assert.equal(a.image, "https://site.example/media/hero.jpg");
  assert.equal(a.title, "Titel - Seite");
  // A page with nothing to read says so.
  await assert.rejects(fetchArticle("https://x.example/p", { fetchText: async () => ({ text: "<html><body><p>kurz</p></body></html>", url: "https://x.example/p", type: "text/html" }) }), /No readable text/);
  await assert.rejects(fetchArticle("https://x.example/f.pdf", { fetchText: async () => ({ text: "%PDF", url: "https://x.example/f.pdf", type: "application/pdf" }) }), /Not a web page/);
});

test("a Google News link is resolved to the publisher's page first (the page's signature, then Google's own call)", async () => {
  const { fetchArticle } = await import("@/plugins/news/reader");
  const calls: string[] = [];
  const a = await fetchArticle("https://news.google.com/rss/articles/CBMiABC?oc=5", {
    fetchText: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://news.google.com/rss/articles/")) return { text: '<c-wiz data-n-a-sg="SIG" data-n-a-ts="1791829966"></c-wiz>', url, type: "text/html" };
      if (url.includes("batchexecute")) {
        assert.match(decodeURIComponent(init?.body ?? ""), /garturlreq[\s\S]*CBMiABC[\s\S]*1791829966[\s\S]*SIG/);
        return { text: `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://www.leipzig.de/news/1", 1])]])}\n`, url, type: "text/plain" };
      }
      return { text: PAGE, url, type: "text/html" };
    },
  });
  assert.equal(a.url, "https://www.leipzig.de/news/1");
  assert.deepEqual(calls.map((c) => c.split(" ")[0]), ["GET", "POST", "GET"]);
});

test("paging: a view comes in pages by offset; the sync reads the best unread items ahead and marks pages it can't read", async () => {
  const s = await import("@/plugins/news/store");
  const { syncNews } = await import("@/plugins/news/sync");
  for (const x of s.listSources()) s.removeSource(x.id);
  const src = s.addSource({ name: "Paging", url: "https://paging.example/rss" });
  s.setPrefs({ interests: [], mutes: [], topicSearch: false, useWork: false, digest: false, prefetch: true, maxAgeDays: 7 });
  const nowMs = Date.now();
  const xml = `<rss><channel>${Array.from({ length: 30 }, (_, i) => `<item><title>Meldung Nummer ${i} über Dinge ${"x".repeat(i)}</title><link>https://paging.example/${i}</link><pubDate>${new Date(nowMs - i * 3600e3).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
  const r = await syncNews({
    now: () => nowMs,
    fetchText: async () => xml,
    fetchArticle: async (url) => {
      if (url.endsWith("/3")) throw new Error("paywall");
      return { text: "Der ganze Artikel.", image: "https://img.example/x.jpg", title: "t", url };
    },
  });
  assert.match(r.message, /read in full/);
  assert.equal(s.getContent(s.listItems({ view: "latest", sourceId: src.id, limit: 1 })[0].id)!.content, "Der ganze Artikel.");
  const first = s.listItems({ view: "latest", sourceId: src.id, limit: 10 });
  const second = s.listItems({ view: "latest", sourceId: src.id, limit: 10, offset: 10 });
  assert.equal(new Set([...first, ...second].map((i) => i.id)).size, 20, "pages don't overlap");
  assert.ok(first[0].hasContent && first[0].image === "https://img.example/x.jpg");
  const failed = s.listItems({ view: "latest", sourceId: src.id, limit: 30 }).find((i) => i.url.endsWith("/3"))!;
  assert.equal(failed.hasContent, false);
  assert.equal(s.getContent(failed.id)!.content, s.UNREADABLE, "marked, not tried again with every fetch");
  assert.ok(!s.withoutContent(30, 7).some((i) => i.id === failed.id));

});

test("items kept before the pictures existed get one: a later fetch fills it in, a page without one is remembered, and 'looked at' is told apart from 'not looked at'", async () => {
  const s = await import("@/plugins/news/store");
  const src = s.addSource({ name: "Pics", url: "https://pics.example/rss" });
  const base = { guid: "p", summary: "", publishedAt: new Date().toISOString() };
  s.addItems({ id: src.id, name: "Pics" }, [{ ...base, guid: "1", url: "https://pics.example/1", title: "Ohne Bild eins" }, { ...base, guid: "2", url: "https://pics.example/2", title: "Ohne Bild zwei" }]);
  const get = (n: number) => s.listItems({ view: "latest", sourceId: src.id, limit: 10 }).find((i) => i.url.endsWith(`/${n}`))!;
  assert.deepEqual([get(1).image, get(1).imageChecked], ["", false], "not looked at yet");
  // The feed has a picture for it now.
  assert.equal(s.addItems({ id: src.id, name: "Pics" }, [{ ...base, guid: "1", url: "https://pics.example/1", title: "Ohne Bild eins", image: "https://img.example/1.jpg" }]), 0);
  assert.equal(get(1).image, "https://img.example/1.jpg");
  // A page looked at without a picture in it: remembered.
  s.setContent(get(2).id, "Text des Artikels, lang genug.");
  assert.deepEqual([get(2).image, get(2).imageChecked, get(2).hasContent], ["", true, true]);
  s.setContent(get(2).id, "Text", "https://img.example/2.jpg");
  assert.equal(get(2).image, "https://img.example/2.jpg", "a picture found later still replaces the 'none'");
});
