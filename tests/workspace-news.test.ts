import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The news you kept — saved or liked — as a database of the Workspace: a source the News plugin brings. The feed itself stays in
 * News (thousands of items, scored all the time); what you keep is what an agent can read, summarise and work with. A two-way view:
 * taking the check from "Saved" or "Liked" there takes it back in News.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "news"]) setInstalled(id, true);
  const n = await import("@/plugins/news/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const src = n.addSource({ name: "Heise", url: "https://heise.example/rss", category: "Tech" });
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  n.addItems({ id: src.id, name: "Heise" }, [
    { guid: "a", url: "https://heise.example/a", title: "Neues Betriebssystem erscheint", summary: "Das Update bringt viele Neuerungen.", publishedAt: at(2) },
    { guid: "b", url: "https://heise.example/b", title: "Sicherheitslücke im Router", summary: "Hersteller rät zum Update.", publishedAt: at(3) },
    { guid: "c", url: "https://heise.example/c", title: "Quartalszahlen eines Konzerns", summary: "Umsatz stieg.", publishedAt: at(4) },
    { guid: "d", url: "https://heise.example/d", title: "Wetter am Wochenende", summary: "Sonnig.", publishedAt: at(5) },
  ]);
  const id = (guid: string) => n.listItems({ view: "latest", limit: 50 }).find((i) => i.url.endsWith(`/${guid}`))!.id;
  return { n, w, runPipeline, createExtSourceDatabase, id };
}

test("the news source: the saved and the liked ones — not the rest, not the hidden", async () => {
  const { n, w, runPipeline, createExtSourceDatabase, id } = await world();
  n.setState(id("a"), "saved");
  n.vote(id("b"), 1);
  n.setState(id("d"), "hidden");
  const db = await createExtSourceDatabase("news", "Gemerkte News");
  const r = await runPipeline(db, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(db)!;
  assert.equal(d.schema.dataType, "news");
  const rows = w.rawRows(db);
  assert.deepEqual(rows.map((x) => x.title).sort(), ["Neues Betriebssystem erscheint", "Sicherheitslücke im Router"], "saved a, liked b; c is just in the feed, d hidden");
  const col = (name: string) => d.schema.properties.find((p) => p.name === name)!.id;
  const a = rows.find((x) => x.title.startsWith("Neues"))!;
  assert.equal(a.cells[col("Publisher")], "Heise");
  assert.equal(a.cells[col("Saved")], true);
  assert.notEqual(a.cells[col("Liked")], true);
  assert.equal(a.cells[col("Link")], "https://heise.example/a");
  const b = rows.find((x) => x.title.startsWith("Sicherheit"))!;
  assert.equal(b.cells[col("Liked")], true);
  assert.match(w.getPage(a.id)!.content ? JSON.stringify(w.getPage(a.id)!.content) : "", /Neuerungen/, "its text, as the row's page — what an agent reads");
});

test("two ways: taking the check from Saved or Liked takes it back in News — and what you drop in News leaves the database", async () => {
  const { n, w, runPipeline, createExtSourceDatabase, id } = await world();
  n.setState(id("a"), "saved");
  n.vote(id("b"), 1);
  const db = await createExtSourceDatabase("news", "Gemerkte News 2");
  await runPipeline(db, { ai: false });
  const d = w.getDatabase(db)!;
  const col = (name: string) => d.schema.properties.find((p) => p.name === name)!.id;
  const rowOf = (title: string) => w.rawRows(db).find((x) => x.title.startsWith(title))!;
  w.setCell(rowOf("Neues").id, col("Saved"), false);
  w.setCell(rowOf("Sicherheit").id, col("Liked"), false);
  await runPipeline(db, { ai: false });
  assert.notEqual(n.getItem(id("a"))!.state, "saved", "unsaved in News");
  assert.equal(n.getItem(id("b"))!.vote, 0, "unliked in News");
  assert.equal(w.rawRows(db).length, 0, "neither is kept now: both rows are gone");
  // the other way: saved in News shows up; dropped in News goes
  n.setState(id("c"), "saved");
  await runPipeline(db, { ai: false });
  assert.deepEqual(w.rawRows(db).map((x) => x.title), ["Quartalszahlen eines Konzerns"]);
  n.setState(id("c"), "read");
  await runPipeline(db, { ai: false });
  assert.equal(w.rawRows(db).length, 0);
});

test("ensureNewsDatabase: made once with the News plugin — a gone one is not made again; a summary agent template reads it", async () => {
  const { w } = await world();
  const { ensureNewsDatabase, newsDatabase } = await import("@/plugins/workspace/news-database");
  await ensureNewsDatabase();
  const db = newsDatabase();
  assert.ok(db, "a news database");
  assert.equal(w.getDatabase(db!)!.schema.dataType, "news");
  const before = w.tree().length;
  await ensureNewsDatabase();
  assert.equal(w.tree().length, before, "once");
  w.archivePage(db!);
  await ensureNewsDatabase();
  assert.equal(newsDatabase(), null, "not made again");

  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  assert.ok(templateMetas().some((m) => m.key === "news-summary"), "a template for the summary agent");
  const r = await import("@/plugins/workspace/routines");
  const agent = await fromTemplate("news-summary", null);
  assert.equal(r.getRoutine(agent)!.kind, "agent");
  const { buildAgentPrompt } = await import("@/plugins/workspace/routine-agent");
  assert.match(buildAgentPrompt(agent, { kind: "manual" }), /Gemerkte News|Saved news/i, "it is told which database to read");
});

test("an article's picture comes along as the Image field — only a real address, never the 'none found' marker", async () => {
  const { n, w, runPipeline, createExtSourceDatabase, id } = await world();
  n.setState(id("a"), "saved");
  n.setState(id("b"), "saved");
  n.setContent(id("a"), "Text des Artikels, lang genug.", "https://cdn.example/bild.jpg");
  n.markNoImage(id("b"));
  const db = await createExtSourceDatabase("news", "Bilder");
  await runPipeline(db, { ai: false });
  const d = w.getDatabase(db)!;
  const image = d.schema.properties.find((p) => p.name === "Image")!;
  assert.equal(image.id, "newsimage");
  const rows = w.rawRows(db);
  assert.equal(rows.find((x) => x.title.startsWith("Neues"))!.cells.newsimage, "https://cdn.example/bild.jpg");
  assert.ok(!rows.find((x) => x.title.startsWith("Sicherheit"))!.cells.newsimage, "no picture: no value");
});

test("the news database opens as cards (a gallery, first); one made before gets it once — and a view you remove stays removed", async () => {
  const { w } = await world();
  const { ensureNewsDatabase, newsDatabase } = await import("@/plugins/workspace/news-database");
  const { setPref } = await import("@/lib/prefs");
  setPref("workspace.newsDb", null); // (an earlier test's database is gone: start fresh)
  await ensureNewsDatabase();
  const db = newsDatabase()!;
  assert.ok(db);
  const types = () => w.getDatabase(db)!.schema.views.map((v) => v.type);
  assert.equal(types()[0], "gallery", "cards first");
  assert.ok(types().includes("table"));
  // one made before cards existed: no gallery, the marker not set
  w.updateSchema(db, { ...w.getDatabase(db)!.schema, views: w.getDatabase(db)!.schema.views.filter((v) => v.type !== "gallery") });
  setPref("workspace.newsCards", null);
  await ensureNewsDatabase();
  assert.equal(types()[0], "gallery", "added once");
  w.updateSchema(db, { ...w.getDatabase(db)!.schema, views: w.getDatabase(db)!.schema.views.filter((v) => v.type !== "gallery") });
  await ensureNewsDatabase();
  assert.ok(!types().includes("gallery"), "removed by you: not made again");
});

test("the cards hide the pipeline's own fields and the details — what stays is publisher, date, link and the checks", async () => {
  const { w } = await world();
  const { ensureNewsDatabase, newsDatabase } = await import("@/plugins/workspace/news-database");
  const { setPref } = await import("@/lib/prefs");
  setPref("workspace.newsDb", null);
  await ensureNewsDatabase();
  const cards = w.getDatabase(newsDatabase()!)!.schema.views[0];
  assert.equal(cards.type, "gallery");
  for (const id of ["srcref", "srcedited", "newsscore", "newstags", "newsstory", "newsimage"]) assert.ok(cards.hidden.includes(id), `${id} is not on the cards`);
  for (const id of ["newssource", "newspublished", "newslink", "newssaved", "newsliked"]) assert.ok(!cards.hidden.includes(id), `${id} stays`);
});

test("cards made before they hid the fields get that once", async () => {
  const { w } = await world();
  const { ensureNewsDatabase, newsDatabase } = await import("@/plugins/workspace/news-database");
  const { setPref } = await import("@/lib/prefs");
  setPref("workspace.newsDb", null);
  await ensureNewsDatabase();
  const db = newsDatabase()!;
  const cur = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...cur, views: cur.views.map((v) => (v.type === "gallery" ? { ...v, hidden: [] } : v)) });
  setPref("workspace.newsCardsHidden", null);
  await ensureNewsDatabase();
  assert.ok(w.getDatabase(db)!.schema.views.find((v) => v.type === "gallery")!.hidden.includes("srcref"));
  // set by you since: left alone
  const again = w.getDatabase(db)!.schema;
  w.updateSchema(db, { ...again, views: again.views.map((v) => (v.type === "gallery" ? { ...v, hidden: [] } : v)) });
  await ensureNewsDatabase();
  assert.deepEqual(w.getDatabase(db)!.schema.views.find((v) => v.type === "gallery")!.hidden, [], "once only");
});
