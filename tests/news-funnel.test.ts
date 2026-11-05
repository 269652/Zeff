import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

before(async () => {
  (await import("@/plugins/news/store")).setPrefs({ autoDiscover: false, useWork: false, useProfile: false, funnel: false });
});
beforeEach(async () => {
  const s = await import("@/plugins/news/store");
  for (const x of s.listSources()) s.removeSource(x.id);
  (await import("@/db")).getSqlite().exec("delete from news_items; delete from news_terms; delete from news_gone; delete from news_similar");
  s.setPrefs({ funnel: false, interests: [], mutes: [] });
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

test("clearing away: only the newest and the best stay, besides what you saved, liked, the agent let through or found important, and the best report of a big story — and what went doesn't come back", async () => {
  const s = await import("@/plugins/news/store");
  const src = s.addSource({ name: "Flut", url: "https://flood.example/rss" });
  // 60 items, one an hour back; the interest makes a few old ones the best.
  s.addItems({ id: src.id, name: "Flut" }, Array.from({ length: 60 }, (_, i) => ({ guid: `${i}`, url: `https://flood.example/${i}`, title: `Meldung Nummer ${i} ${i % 20 === 7 ? "Quantenphysik" : "Allerlei"} ${"x".repeat(i % 5)}`, summary: "", publishedAt: hoursAgo(i) })));
  s.setPrefs({ interests: [{ term: "Quantenphysik", weight: 3 }] });
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));
  const all = s.listItems({ view: "latest", limit: 100 });
  const byN = (n: number) => all.find((i) => i.url.endsWith(`/${n}`))!;
  s.setState(byN(50).id, "saved");
  s.vote(byN(51).id, 1);
  s.setGate([{ id: byN(52).id, gate: "pass", why: "passt" }, { id: byN(53).id, gate: "top", why: "wichtig" }, { id: byN(54).id, gate: "drop", why: "nein" }]);
  // A big story: four outlets report it — its best report stays.
  for (const [k, n] of [[0, 40], [1, 41], [2, 42], [3, 43]] as const) (await import("@/db")).getSqlite().prepare("update news_items set story = 'Großes Ereignis', source_name = ? where id = ?").run(`Outlet ${k}`, byN(n).id);
  (await import("@/db")).getSqlite().prepare("update news_items set score = 0.01 where id in (?, ?, ?)").run(byN(40).id, byN(41).id, byN(43).id);
  (await import("@/db")).getSqlite().prepare("update news_items set score = 0.02 where id = ?").run(byN(42).id);

  const gone = s.trim({ keepLatest: 20, maxAgeDays: 7 });
  const left = new Set(s.listItems({ view: "latest", limit: 100 }).map((i) => Number(i.url.split("/").pop())));
  for (let n = 0; n < 20; n++) assert.ok(left.has(n), `the newest stay (${n})`);
  for (const n of [27, 47]) assert.ok(left.has(n), `the best (the interest) stay (${n})`);
  assert.ok(s.getItem(byN(50).id), "saved stays");
  assert.ok(s.getItem(byN(51).id), "liked stays");
  assert.ok(s.getItem(byN(52).id) && s.getItem(byN(53).id), "let through and important stay");
  assert.ok(s.getItem(byN(54).id), "filtered out today stays (its view)");
  assert.ok(s.getItem(byN(42).id), "the best report of the big story stays");
  assert.ok(!s.getItem(byN(41).id), "the rest of the big story goes");
  assert.ok(!s.getItem(byN(55).id), "the rest goes");
  assert.ok(gone > 20);
  // The feed still carries what went: it isn't brought back.
  assert.equal(s.addItems({ id: src.id, name: "Flut" }, [{ guid: "55", url: "https://flood.example/55", title: "Meldung Nummer 55 Allerlei", summary: "", publishedAt: hoursAgo(55) }]), 0);
  assert.equal(s.addItems({ id: src.id, name: "Flut" }, [{ guid: "new", url: "https://flood.example/new", title: "Ganz neu", summary: "", publishedAt: hoursAgo(0) }]), 1);
  // Old: what went, past the days fetched, is forgotten — and liked items outlive the age limit too.
  assert.equal(s.prune(0) >= 1, true);
  assert.ok(s.getItem(byN(51).id), "liked outlives prune");
});

test("the funnel: the agent reads the best new headlines with your taste, its verdicts are kept with why — For you shows only what it let through, the important first; the rest is under Filtered out", async () => {
  const s = await import("@/plugins/news/store");
  const { runFunnel, funnelPrompt } = await import("@/plugins/news/funnel");
  const src = s.addSource({ name: "Mix", url: "https://mix.example/rss" });
  const titles = ["Quantencomputer rechnet fehlerfrei", "Promi heiratet auf Ibiza", "Erdbeben erschüttert Japan", "Neue Gartentipps für den Herbst"];
  s.addItems({ id: src.id, name: "Mix" }, titles.map((t, i) => ({ guid: `${i}`, url: `https://mix.example/${i}`, title: t, summary: `Kurztext ${i}`, publishedAt: hoursAgo(i + 1) })));
  s.rescore(() => ({ prefs: s.getPrefs(), work: [], sourceWeight: 1, sourceVotes: 0 }));

  // Off: nothing happens, For you shows everything.
  assert.deepEqual(await runFunnel({ ask: async () => ({ items: [] }) }), { judged: 0, passed: 0, top: 0, dropped: 0 });
  assert.equal(s.listItems({ view: "foryou" }).length, 4);

  s.setPrefs({ funnel: true, funnelBatch: 60 });
  let prompt = "";
  const r = await runFunnel({
    context: () => ({ taste: "Du liest gern über Quantenphysik.", likes: ["Quanten"], avoids: ["Promis"], profile: [], liked: ["Qubits werden stabiler"], disliked: [] }),
    ask: async (p) => {
      prompt = p;
      const n = (t: string) => p.split("\n").find((l) => /^\d+\. /.test(l) && l.includes(t))!.split(".")[0];
      return {
        items: [
          { n: Number(n("Quantencomputer")), verdict: "pass", why: "Dein Thema Quantenphysik" },
          { n: Number(n("Erdbeben")), verdict: "top", why: "Großes Ereignis" },
          { n: Number(n("Promi")), verdict: "drop", why: "Klatsch" },
          { n: 99, verdict: "pass", why: "gibt es nicht" },
          { n: Number(n("Promi")), verdict: "pass", why: "doppelt" },
        ],
      };
    },
  });
  assert.deepEqual(r, { judged: 3, passed: 1, top: 1, dropped: 1 });
  assert.match(prompt, /Du liest gern über Quantenphysik/);
  assert.match(prompt, /Meidet: Promis/);
  assert.match(prompt, /\[Mix\] Quantencomputer rechnet fehlerfrei — Kurztext 0/);

  const foryou = s.listItems({ view: "foryou" });
  assert.deepEqual(foryou.map((i) => i.title), ["Erdbeben erschüttert Japan", "Quantencomputer rechnet fehlerfrei"], "only what got through, the important first");
  assert.equal(foryou[0].gate, "top");
  assert.equal(foryou[1].gateWhy, "Dein Thema Quantenphysik");
  assert.deepEqual(s.listItems({ view: "filtered" }).map((i) => i.title), ["Promi heiratet auf Ibiza"]);
  assert.equal(s.listItems({ view: "latest" }).length, 4, "everything, unfiltered");
  const c = s.counts();
  assert.equal(c.unread, 2);
  assert.equal(c.filtered, 1);
  assert.equal(c.waiting, 1, "the garden tips weren't answered: looked at again next round");
  assert.equal(s.countNewSince(hoursAgo(1)), 2, "N new: what the agent let through");
  const st = s.funnelStats();
  assert.equal(st.judged, 3);
  assert.equal(st.top, 1);

  // The next round only reads what it hasn't read yet.
  let asked: string[] = [];
  await runFunnel({ context: () => ({ taste: "", likes: [], avoids: [], profile: [], liked: [], disliked: [] }), ask: async (p) => ((asked = p.split("\n").filter((l) => /^\d+\. /.test(l))), { items: [] }) });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Gartentipps/);
  assert.match(funnelPrompt({ taste: "", likes: [], avoids: [], profile: [], liked: [], disliked: [] }, []), /noch nicht beschrieben/);
});

test("the sync lets the agent look, then clears away — and says so", async () => {
  const s = await import("@/plugins/news/store");
  const { syncNews } = await import("@/plugins/news/sync");
  s.addSource({ name: "Feed", url: "https://sync.example/rss" });
  s.setPrefs({ funnel: true, keepLatest: 20, topicSearch: false, digest: false, prefetch: false, aiTags: false });
  const feed = `<rss><channel>${Array.from({ length: 30 }, (_, i) => `<item><title>Schlagzeile ${i} ${"y".repeat(i)}</title><link>https://sync.example/${i}</link><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
  let looked = 0;
  const r = await syncNews({ fetchText: async () => feed, funnel: async () => ((looked++), { judged: 5, passed: 2, top: 1 }), aiTags: async () => undefined });
  assert.equal(looked, 1);
  assert.match(r.message, /the filter let 3 of 5 through/);
  assert.match(r.message, /5 cleared away/);
  assert.equal(s.countItems(), 20);
  assert.equal(s.funnelStats().fetched, 25, "at most 25 per source");
  assert.equal(s.funnelStats().cleared, 5);
});

test("stories: Important first (the agent's top and the best report of a big story), then the stories with something unseen, each told oldest first; too few — the best unseen make one", async () => {
  const { storyGroups } = await import("@/plugins/news/story-groups");
  const item = (id: number, o: Partial<import("@/plugins/news/shared").NewsItem> = {}): import("@/plugins/news/shared").NewsItem => ({ id, sourceId: 1, sourceName: "S", url: `https://x/${id}`, title: `T${id}`, summary: "", image: "", imageChecked: true, hasContent: false, publishedAt: hoursAgo(id), state: "new", vote: 0, score: 10 - id, terms: [], story: "", storySources: 0, gate: "", gateWhy: "", seen: false, category: "", reasons: [], ...o });
  const pool = [
    item(1, { gate: "top" }),
    item(2, { story: "Wahl", storySources: 5 }),
    item(3, { story: "Wahl", storySources: 5 }),
    item(4, { story: "Gipfel", storySources: 2, seen: true }),
    item(5, { story: "Gipfel", storySources: 2, seen: true }),
    item(6, { story: "Streik", storySources: 2 }),
    item(7, { story: "Streik", storySources: 2 }),
    item(8, { story: "Einzeln", storySources: 1 }),
    item(9, { gate: "drop", story: "Streik" }),
  ];
  const g = storyGroups(pool);
  assert.deepEqual(g.map((x) => x.key), ["top", "story:Wahl", "story:Streik", "story:Gipfel"]);
  assert.deepEqual(g[0].items.map((i) => i.id), [1, 2], "the agent's top and the best of the big story");
  assert.deepEqual(g[2].items.map((i) => i.id), [7, 6], "oldest first, the filtered out not in it");
  const few = storyGroups([item(1), item(2), item(3)]);
  assert.deepEqual(few.map((x) => x.kind), ["best"]);
});

test("stale headlines the agent hasn't read go before it reads: it never sees them, and a feed doesn't bring them back; what you kept stays", async () => {
  const s = await import("@/plugins/news/store");
  const { runFunnel } = await import("@/plugins/news/funnel");
  const src = s.addSource({ name: "Alt", url: "https://stale.example/rss" });
  const item = (n: string, hours: number) => ({ guid: n, url: `https://stale.example/${n}`, title: `Eine Meldung namens ${n} von gestern`, summary: "", publishedAt: hoursAgo(hours) });
  s.addItems({ id: src.id, name: "Alt" }, [item("alt", 72), item("gemerkt", 72), item("gemocht", 72), item("gesehen", 72), item("gelesen-vom-agenten", 72), item("frisch", 2)]);
  const all = s.listItems({ view: "latest", limit: 10 });
  const by = (n: string) => all.find((i) => i.url.endsWith(`/${n}`))!;
  s.setState(by("gemerkt").id, "saved");
  s.vote(by("gemocht").id, 1);
  s.markSeen([by("gesehen").id]);
  s.setGate([{ id: by("gelesen-vom-agenten").id, gate: "pass", why: "passt" }]);

  // With the agent off everything is shown, so nothing goes.
  assert.equal(s.clearStale(), 0);
  s.setPrefs({ funnel: true });
  const asked: string[] = [];
  await runFunnel({
    ask: async (prompt) => {
      asked.push(prompt);
      return { items: [{ n: 1, verdict: "drop", why: "nein" }] };
    },
    context: () => ({ taste: "", likes: [], avoids: [], profile: [], liked: [], disliked: [] }),
  });
  assert.equal(asked.length, 1);
  assert.ok(asked[0].includes("frisch") && !asked[0].includes("namens alt"), "only the fresh one is read");
  assert.ok(!s.getItem(by("alt").id), "the stale one went");
  for (const n of ["gemerkt", "gemocht", "gesehen", "gelesen-vom-agenten"]) assert.ok(s.getItem(by(n).id), `${n} stays`);
  assert.equal(s.addItems({ id: src.id, name: "Alt" }, [item("alt", 72)]), 0, "the feed doesn't bring it back");
  assert.ok(s.funnelStats().cleared >= 1);
});
