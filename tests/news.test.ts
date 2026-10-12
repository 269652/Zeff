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

test("Hacker News's stub (\"Article URL: … Points: 8\") is no summary: the opening of the article takes its place once the page is read", async () => {
  const { parseFeed } = await import("@/plugins/news/feed");
  const { snippetOf } = await import("@/plugins/news/shared");
  const s = await import("@/plugins/news/store");
  const [it] = parseFeed(`<rss><channel><item><title>French supermarkets suffer refrigerator shutdown</title><link>https://www.rnz.co.nz/news/1865776/x</link><comments>https://news.ycombinator.com/item?id=1</comments><pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Article URL: <a href="https://www.rnz.co.nz/news/1865776/x">https://www.rnz.co.nz/news/1865776/x</a></p><p>Comments URL: <a href="https://news.ycombinator.com/item?id=1">https://news.ycombinator.com/item?id=1</a></p><p>Points: 8</p><p># Comments: 1</p>]]></description></item></channel></rss>`);
  assert.equal(it.summary, "");
  const src = s.addSource({ name: "HN", url: "https://hn.example/rss" });
  s.addItems({ id: src.id, name: "HN" }, [{ ...it, publishedAt: new Date().toISOString() }]);
  const get = () => s.listItems({ view: "latest", sourceId: src.id, limit: 5 })[0];
  assert.equal(get().summary, "");
  const article = `${"Ein langer erster Absatz über den Ausfall der Kühlung in französischen Supermärkten nach dem Cyberangriff. ".repeat(2)}\n\nZweiter Absatz.`;
  s.setContent(get().id, article);
  assert.ok(get().summary.startsWith("Ein langer erster Absatz") && get().summary.length <= 330, "the opening of the article");
  assert.equal(snippetOf("Kurz."), "Kurz.");
  // A stub kept before it was dropped is emptied too.
  assert.equal(snippetOf("a ".repeat(400)).endsWith("…"), true);
});

test("a card's look at its page: the picture, the summary and the text are kept; an unreadable page is remembered and not fetched again", async () => {
  const s = await import("@/plugins/news/store");
  const { peekItem } = await import("@/plugins/news/peek");
  const src = s.addSource({ name: "Peek", url: "https://peek.example/rss" });
  const base = { guid: "k", summary: "", publishedAt: new Date().toISOString() };
  s.addItems({ id: src.id, name: "Peek" }, [{ ...base, guid: "1", url: "https://peek.example/1", title: "Lesbar" }, { ...base, guid: "2", url: "https://peek.example/2", title: "Gesperrt" }]);
  const by = (n: number) => s.listItems({ view: "latest", sourceId: src.id, limit: 5 }).find((i) => i.url.endsWith(`/${n}`))!;
  let calls = 0;
  const fetchArticle = async (url: string) => {
    calls++;
    if (url.endsWith("/2")) throw new Error("paywall");
    return { text: `${"Der Artikel beginnt hier und geht weiter. ".repeat(5)}\n\nEnde.`, image: "https://img.example/1.jpg", title: "t", url };
  };
  const ok = await peekItem(by(1).id, { fetchArticle });
  assert.deepEqual([ok.ok, ok.image, ok.hasContent], [true, "https://img.example/1.jpg", true]);
  assert.ok(ok.summary.startsWith("Der Artikel beginnt"));
  assert.equal(by(1).image, "https://img.example/1.jpg");
  assert.equal((await peekItem(by(2).id, { fetchArticle })).ok, false);
  const before = calls;
  assert.equal((await peekItem(by(2).id, { fetchArticle })).ok, false);
  assert.equal(calls, before, "not fetched again");
});

test("the catalog: hundreds of checked outlets plus topic packs, unique, every starter-pack name in it, every category known", async () => {
  const { ALL_FEEDS, CATALOG, STARTER_NAMES, starterFeeds, categoriesOf, CATEGORY_ORDER } = await import("@/plugins/news/catalog");
  assert.ok(CATALOG.length >= 400, `${CATALOG.length} checked outlets`);
  assert.ok(ALL_FEEDS.length >= 900, `${ALL_FEEDS.length} feeds in all`);
  assert.equal(new Set(ALL_FEEDS.map((f) => f.url)).size, ALL_FEEDS.length, "no address twice");
  assert.ok(ALL_FEEDS.every((f) => /^https?:\/\//.test(f.url) && f.name && f.category && f.lang));
  const missing = STARTER_NAMES.filter((n) => !CATALOG.some((f) => f.name === n));
  assert.deepEqual(missing, [], "the starter pack only has feeds that are in the catalog");
  assert.equal(starterFeeds().length, STARTER_NAMES.length);
  assert.ok(categoriesOf().every((c) => (CATEGORY_ORDER as readonly string[]).includes(c.category)));
  assert.ok(new Set(ALL_FEEDS.map((f) => f.lang)).size >= 3, "several languages");
});

test("sources come with a category and language; many at once; a source that keeps failing is tried once a day; a category filters the items", async () => {
  const s = await import("@/plugins/news/store");
  for (const x of s.listSources()) s.removeSource(x.id);
  const n = s.addSources([
    { name: "A", url: "https://cat.example/a", category: "Tech", lang: "de" },
    { name: "B", url: "https://cat.example/b", category: "Science", lang: "en" },
  ]);
  assert.equal(n, 2);
  assert.equal(s.addSources([{ name: "A", url: "https://cat.example/a", category: "Tech", lang: "de" }]), 0, "the same address isn't added twice");
  const [a, b] = s.listSources();
  assert.deepEqual([a.category, a.lang, b.category], ["Tech", "de", "Science"]);
  const base = { guid: "g", summary: "", publishedAt: new Date().toISOString() };
  s.addItems({ id: a.id, name: "A" }, [{ ...base, guid: "1", url: "https://cat.example/a/1", title: "Nur Technik hier" }]);
  s.addItems({ id: b.id, name: "B" }, [{ ...base, guid: "2", url: "https://cat.example/b/1", title: "Nur Wissenschaft hier" }]);
  assert.deepEqual(s.listItems({ view: "latest", category: "Science" }).map((i) => i.title), ["Nur Wissenschaft hier"]);
  // Failing: five in a row, then left alone for a day.
  for (let i = 0; i < 5; i++) s.recordFetch(a.id, "HTTP 500");
  const failing = s.listSources().find((x) => x.id === a.id)!;
  assert.equal(failing.fails, 5);
  assert.equal(s.dueForFetch(failing), false);
  assert.equal(s.dueForFetch(failing, Date.now() + 2 * 864e5), true, "tried again after a day");
  s.recordFetch(a.id, null);
  assert.equal(s.listSources().find((x) => x.id === a.id)!.fails, 0, "a success starts over");
});

test("a feed that hasn't changed (304) costs nothing and isn't a failure; a source that keeps failing is skipped", async () => {
  const s = await import("@/plugins/news/store");
  const { syncNews } = await import("@/plugins/news/sync");
  for (const x of s.listSources()) s.removeSource(x.id);
  const same = s.addSource({ name: "Same", url: "https://same.example/rss" });
  const dead = s.addSource({ name: "Dead", url: "https://dead.example/rss" });
  for (let i = 0; i < 5; i++) s.recordFetch(dead.id, "HTTP 500");
  s.setPrefs({ interests: [], mutes: [], topicSearch: false, useWork: false, digest: false, prefetch: false });
  const asked: string[] = [];
  const r = await syncNews({ fetchFeed: async (url) => (asked.push(url), { text: null }) });
  assert.deepEqual(asked, ["https://same.example/rss"], "the dead one isn't asked");
  assert.match(r.message, /0 new from 1 of 1 sources \(1 unchanged\)/);
  assert.equal(s.listSources().find((x) => x.id === same.id)!.lastError, null);
});

test("topic packs: every topic gives a news search in two languages (and Bing, Medium)", async () => {
  const { topicFeeds, TOPICS } = await import("@/plugins/news/topics");
  const feeds = topicFeeds();
  assert.ok(TOPICS.length >= 100 && feeds.length >= 450);
  assert.ok(feeds.some((f) => /news\.google\.com\/rss\/search\?q=.*&hl=de/.test(f.url)));
  assert.ok(feeds.some((f) => /bing\.com\/news\/search\?q=.*format=rss/.test(f.url)));
  assert.ok(feeds.some((f) => /medium\.com\/feed\/tag\//.test(f.url)));
});

const feedXml = (title: string, n = 4) => `<rss><channel><title>${title}</title>${Array.from({ length: n }, (_, i) => `<item><title>Beitrag ${i}</title><link>https://x.example/${i}</link><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;

test("discovery: an address that is a feed, a page that announces its feeds, the usual paths, the well-known places — only feeds with items count", async () => {
  const { discoverFeeds, feedLinksIn, knownPlaces, isPublicUrl } = await import("@/plugins/news/discover");
  const pages: Record<string, string> = {
    "https://blog.example/feed.xml": feedXml("Blog"),
    "https://site.example/": `<html><head><link rel="alternate" type="application/atom+xml" title="Atom" href="/atom/all.xml"><link rel="stylesheet" href="/x.css"></head></html>`,
    "https://site.example/atom/all.xml": feedXml("Site Atom"),
    "https://plain.example/": "<html></html>",
    "https://plain.example/rss.xml": feedXml("Plain RSS", 5),
    "https://www.reddit.com/r/rust/.rss": feedXml("rust"),
  };
  const get = async (url: string) => {
    if (!(url in pages)) throw new Error("HTTP 404");
    return { text: pages[url], url };
  };
  assert.equal((await discoverFeeds("https://blog.example/feed.xml", { get }))[0].title, "Blog", "the address is the feed");
  assert.equal((await discoverFeeds("site.example", { get }))[0].url, "https://site.example/atom/all.xml", "the page says where it is");
  assert.equal((await discoverFeeds("https://plain.example", { get }))[0].url, "https://plain.example/rss.xml", "the usual path");
  assert.equal((await discoverFeeds("https://www.reddit.com/r/rust", { get }))[0].url, "https://www.reddit.com/r/rust/.rss", "a subreddit");
  assert.deepEqual(await discoverFeeds("https://nothing.example", { get }), []);
  assert.deepEqual(feedLinksIn(pages["https://site.example/"], "https://site.example/"), ["https://site.example/atom/all.xml"]);
  assert.deepEqual(knownPlaces(new URL("https://github.com/vercel/next.js")), ["https://github.com/vercel/next.js/releases.atom", "https://github.com/vercel/next.js/commits.atom"]);
  assert.deepEqual(knownPlaces(new URL("https://foo.substack.com/p/x")), ["https://foo.substack.com/feed"]);
  // Only the public web.
  for (const bad of ["http://localhost:3000/feed", "http://192.168.1.5/rss", "http://10.0.0.1/", "file:///etc/passwd", "https://intranet.local/x"]) assert.equal(isPublicUrl(bad), false, bad);
  assert.deepEqual(await discoverFeeds("http://localhost:9444", { get }), []);
});

test("the feed finder: a topic's news names its publishers, an AI names outlets, their sites are searched — only working feeds come back, with why", async () => {
  const { findFeeds, publishersOf } = await import("@/plugins/news/finder");
  const googleXml = `<rss><channel>${[["https://www.quantamagazine.org", "Quanta Magazine"], ["https://www.quantamagazine.org", "Quanta Magazine"], ["https://news.google.com", "Google"], ["https://dead.example", "Dead News"], ["https://phys.example", "Phys"]]
    .map(([u, n], i) => `<item><title>T${i}</title><link>https://news.google.com/rss/articles/x${i}</link><source url="${u}">${n}</source></item>`).join("")}</channel></rss>`;
  assert.deepEqual(publishersOf(googleXml).map((p) => [p.host, p.count]), [["quantamagazine.org", 2], ["dead.example", 1], ["phys.example", 1]], "aggregators out, most mentioned first");
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (url.startsWith("https://news.google.com/rss/search")) return { text: googleXml, url };
    if (url === "https://quantamagazine.org/feed" || url === "https://quantamagazine.org/feed/") return { text: feedXml("Quanta"), url };
    if (url === "https://phys.example/rss.xml") return { text: feedXml("Phys", 6), url };
    if (url === "https://blog.ai-picked.example/feed") return { text: feedXml("AI pick", 5), url };
    throw new Error("HTTP 404");
  };
  const ask = async () => ({ outlets: [{ name: "AI Pick", domain: "https://blog.ai-picked.example/", why: "Du liest über Mathematik." }, { name: "Intern", domain: "localhost" }, { name: "Quanta", domain: "quantamagazine.org", why: "Mathematik, gut erklärt" }] });
  const found = await findFeeds("Mathematik", { get, ask, have: new Set(["already.example"]), profile: ["TypeScript"] });
  const by = Object.fromEntries(found.map((s) => [s.domain, s]));
  assert.ok(by["blog.ai-picked.example"] && by["quantamagazine.org"] && by["phys.example"], Object.keys(by).join());
  assert.ok(!by["dead.example"], "a publisher without a feed that answers isn't suggested");
  assert.equal(by["blog.ai-picked.example"].via, "ai");
  assert.equal(by["quantamagazine.org"].why, "Mathematik, gut erklärt", "the AI's reason is kept");
  assert.equal(found[0].via, "ai", "the AI's picks first");
  assert.ok(!asked.some((u) => /localhost/.test(u)), "no local address is ever asked");
  // Without an AI the news route alone still finds feeds.
  const noAi = await findFeeds("Mathematik", { get, ask: async () => { throw new Error("no llm"); } });
  assert.ok(noAi.some((s) => s.domain === "phys.example"));
  // Ones you have are not suggested again.
  assert.ok(!(await findFeeds("Mathematik", { get, ask, have: new Set(["phys.example"]) })).some((s) => s.domain === "phys.example"));
});

test("finding feeds by itself: once a day, for a couple of your interests, the best few are added and logged — and nothing when it is off", async () => {
  const s = await import("@/plugins/news/store");
  const { autoDiscover, discoveries } = await import("@/plugins/news/auto-discover");
  const { setPref } = await import("@/lib/prefs");
  for (const x of s.listSources()) s.removeSource(x.id);
  setPref("news:autodiscover-at", 0);
  const sug = (domain: string, topic: string) => ({ feed: { url: `https://${domain}/feed`, title: domain, items: 9, newest: new Date().toISOString(), sample: [] }, topic, domain, via: "news" as const, why: `Schreibt über ${topic}` });
  const find = async (topic: string) => [sug(`a-${topic.length}.example`, topic), sug(`b-${topic.length}.example`, topic), sug(`c-${topic.length}.example`, topic)];
  s.setPrefs({ autoDiscover: false, interests: [{ term: "Mathematik", weight: 2 }, { term: "Segeln", weight: 1 }] });
  assert.equal(await autoDiscover({ find }), 0, "off: nothing");
  s.setPrefs({ autoDiscover: true });
  const now = Date.now();
  assert.equal(await autoDiscover({ now: () => now, find }), 4, "two topics, two feeds each");
  const added = s.listSources();
  assert.equal(added.length, 4);
  assert.ok(added.every((x) => x.category === "Discovered"));
  assert.equal(discoveries().length, 4);
  assert.match(discoveries()[0].why, /Schreibt über/);
  assert.equal(await autoDiscover({ now: () => now + 3600e3, find }), 0, "not again within the day");
  assert.ok((await autoDiscover({ now: () => now + 2 * 864e5, find })) >= 0, "the next day it looks again");
  s.setPrefs({ autoDiscover: false });
});

test("what Zeff knows about you becomes terms (facts, todos, tickets) with where each came from — and lifts the headlines that match, saying why", async () => {
  const { termsOf } = await import("@/plugins/news/profile");
  const terms = termsOf({
    facts: [{ subject: "Nadines Hobby", text: "Nadine fährt gern Rennrad und klettert am Wochenende" }],
    todos: [{ ref: "T-132", text: "Migration der Datenbank auf Postgres prüfen" }, { ref: "T-140", text: "Postgres Migration testen und Bescheid geben" }],
    tickets: [{ key: "PROJ-364", summary: "Startseite Titel Kubernetes Cluster" }],
  });
  const by = Object.fromEntries(terms.map((t) => [t.term.toLowerCase(), t]));
  assert.equal(by["nadines hobby"].why, "you: Nadines Hobby");
  assert.equal(by.postgres.why, "work: T-132", "the first todo that has the word");
  assert.equal(by.kubernetes.why, "ticket: PROJ-364");
  assert.ok(!by["prüfen"] && !by.bescheid, "words that are in every todo say nothing");
  assert.ok(by.postgres.weight >= by.kubernetes.weight, "todos count a bit more than tickets");
  const base: ScoreContext = { prefs: { interests: [], mutes: [] }, learned: new Map(), work: [], sourceWeight: 1, sourceVotes: 0, now: NOW };
  const it = { title: "Neue Rennrad-Route im Harz", summary: "Postgres hat nichts damit zu tun", publishedAt: "2026-10-12T10:00:00Z" };
  const plain = scoreItem(it, base);
  const known = scoreItem(it, { ...base, profile: [{ term: "Rennrad", weight: 0.8, why: "you: Nadines Hobby" }] });
  assert.ok(known.score > plain.score);
  assert.ok(known.reasons.some((r) => r === "profile: Rennrad · you: Nadines Hobby"));
});

test("the mix: no run of one source, a story from three outlets only once at the top, and every seventh place from something unlike the last", async () => {
  const { diversify } = await import("@/plugins/news/shared");
  const mk = (id: number, source: string, category: string, title: string, score: number) => ({ id, sourceName: source, category, title, score });
  const items = [
    mk(1, "A", "Tech", "Neue Chips von Intel vorgestellt heute", 9),
    mk(2, "A", "Tech", "Zweite Meldung von A über Prozessoren", 8.9),
    mk(3, "A", "Tech", "Dritte Meldung von A über Speicher", 8.8),
    mk(4, "B", "Tech", "Neue Chips von Intel vorgestellt heute", 8.7),
    mk(5, "C", "Tech", "Intel stellt neue Chips vor heute", 8.6),
    mk(6, "D", "Science", "Quantenphysik: ein neues Experiment gelingt", 5),
    mk(7, "E", "Sport", "Bundesliga: Spieltag Ergebnisse im Überblick", 4),
    mk(8, "F", "Tech", "Linux Kernel erscheint in neuer Version", 8.5),
    mk(9, "G", "Tech", "Python bekommt ein neues Feature", 8.4),
    mk(10, "H", "Tech", "Rust Compiler wird schneller", 8.3),
  ];
  const order = diversify(items).map((i) => i.id);
  assert.equal(order[0], 1);
  assert.notEqual(order[1], 2, "not the same source twice in a row while others are almost as good");
  assert.ok(order.indexOf(4) > 3 && order.indexOf(5) > 3, "the same story from other outlets is pushed down");
  assert.ok(order.slice(0, 7).some((id) => id === 6 || id === 7), "something from outside the usual early on");
  assert.equal(order.length, items.length);
  assert.deepEqual(diversify(items).map((i) => i.id), order, "the same every time");
});

test("For you is mixed when it is on, and pages continue the mix", async () => {
  const s = await import("@/plugins/news/store");
  for (const x of s.listSources()) s.removeSource(x.id);
  const a = s.addSource({ name: "Mix A", url: "https://mix.example/a", category: "Tech" });
  const b = s.addSource({ name: "Mix B", url: "https://mix.example/b", category: "Sport" });
  s.setPrefs({ interests: [], mutes: [], diversity: true, useProfile: false, useWork: false });
  const now = new Date().toISOString();
  s.addItems({ id: a.id, name: "Mix A" }, Array.from({ length: 12 }, (_, i) => ({ guid: `a${i}`, url: `https://mix.example/a/${i}`, title: `Technikmeldung Nummer ${i} aus Quelle A ${"x".repeat(i)}`, summary: "", publishedAt: now })));
  s.addItems({ id: b.id, name: "Mix B" }, Array.from({ length: 4 }, (_, i) => ({ guid: `b${i}`, url: `https://mix.example/b/${i}`, title: `Sportmeldung Nummer ${i} aus Quelle B ${"y".repeat(i)}`, summary: "", publishedAt: now })));
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));
  const all = s.listItems({ view: "foryou", limit: 16 });
  const firstFive = all.slice(0, 5).map((i) => i.sourceName);
  assert.ok(firstFive.includes("Mix B"), "the other source comes up early, not after twelve of A");
  const p1 = s.listItems({ view: "foryou", limit: 8 });
  const p2 = s.listItems({ view: "foryou", limit: 8, offset: 8 });
  assert.deepEqual([...p1, ...p2].map((i) => i.id), all.map((i) => i.id), "pages are the same mix");
  s.setPrefs({ diversity: false });
  assert.equal(s.listItems({ view: "foryou", limit: 16 }).length, 16);
  s.setPrefs({ diversity: true, useProfile: true, useWork: true });
});

test("the briefing groups the news into themes that cite their items; themes without real items are dropped", async () => {
  const s = await import("@/plugins/news/store");
  const { buildDigest, getDigest } = await import("@/plugins/news/digest");
  for (const x of s.listSources()) s.removeSource(x.id);
  const src = s.addSource({ name: "Theme", url: "https://theme.example/rss", category: "Tech" });
  s.setPrefs({ interests: [{ term: "Chips", weight: 2 }], mutes: [], useProfile: false, useWork: false, diversity: false });
  const now = new Date().toISOString();
  s.addItems({ id: src.id, name: "Theme" }, ["Neue Chips von Intel", "AMD zieht bei Chips nach", "Wetter bleibt sonnig", "Marsmission startet"].map((title, i) => ({ guid: `t${i}`, url: `https://theme.example/${i}`, title, summary: "", publishedAt: now })));
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));
  const prompts: string[] = [];
  const d = await buildDigest({
    ask: async (p) => (prompts.push(p), { overview: "Chips und Raumfahrt.", themes: [{ title: "Prozessoren", summary: "Intel und AMD bringen neue Chips.", items: [1, 2, 99] }, { title: "Nichts", summary: "Keine echten Meldungen.", items: [42] }], picks: [{ n: 1, why: "Du liest über Chips." }] }),
  });
  assert.match(prompts[0], /Interessen: Chips/);
  assert.equal(d!.themes.length, 1, "a theme that cites nothing real is dropped");
  assert.equal(d!.themes[0].title, "Prozessoren");
  assert.equal(d!.themes[0].ids.length, 2, "an unknown number is dropped, the real ones kept");
  assert.equal(getDigest()!.themes[0].summary, "Intel und AMD bringen neue Chips.");
});

test("ask your news: the question's words find the items, the AI answers from them, the numbers it cites come back as sources", async () => {
  const s = await import("@/plugins/news/store");
  const { askNews, askPrompt } = await import("@/plugins/news/ask");
  for (const x of s.listSources()) s.removeSource(x.id);
  const src = s.addSource({ name: "Ask", url: "https://ask.example/rss" });
  const now = new Date().toISOString();
  s.addItems({ id: src.id, name: "Ask" }, [
    { guid: "1", url: "https://ask.example/1", title: "Quantencomputer: Google zeigt neuen Chip", summary: "Fehlerkorrektur gelingt", publishedAt: now },
    { guid: "2", url: "https://ask.example/2", title: "Fußball: Spielplan veröffentlicht", summary: "", publishedAt: now },
    { guid: "3", url: "https://ask.example/3", title: "IBM baut Quantencomputer mit 1000 Qubits", summary: "", publishedAt: now },
  ]);
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));
  const prompts: string[] = [];
  const r = await askNews("Was gibt es Neues zu Quantencomputern?", { ask: async (p) => (prompts.push(p), { answer: "Google zeigt einen neuen Chip [1]; IBM baut einen mit 1000 Qubits [2].", cites: [1] }) });
  assert.match(prompts[0], /Quantencomputer: Google zeigt neuen Chip/);
  assert.doesNotMatch(prompts[0], /Spielplan/, "only items about the question go to the AI");
  assert.equal(r.sources.length, 2, "cited in the text or in the list");
  assert.ok(r.sources.every((x) => /quantencomputer/i.test(x.title)));
  assert.deepEqual((await askNews("Wie wird das Wetter auf dem Jupiter?", { ask: async () => ({ answer: "x", cites: [] }) })).sources, []);
  assert.match((await askNews("Wie wird das Wetter auf dem Jupiter?", { ask: async () => ({ answer: "x", cites: [] }) })).answer, /nichts gefunden/);
  await assert.rejects(askNews("a"), /question/i);
  assert.match(askPrompt("F", [{ n: 1, source: "S", title: "T", text: "X" }]), /\[1\] \(S\) T\nX/);
});

test("listening: long texts are read in pieces of sentences", async () => {
  const { chunks } = await import("@/plugins/news/Listen");
  const text = `${"Dies ist ein Satz mit etwas Länge. ".repeat(30)}\n\nNoch ein Absatz.`;
  const parts = chunks(text);
  assert.ok(parts.length > 3 && parts.every((p) => p.length <= 220 * 1.6), parts.map((p) => p.length).join());
  assert.equal(parts[parts.length - 1], "Noch ein Absatz.");
  assert.deepEqual(chunks(""), []);
});
