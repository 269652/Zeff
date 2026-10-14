import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("the full-text index ranks mails and Teams by relevance, folds umlauts, matches word beginnings — and keeps up with new rows", async () => {
  const { getDb, schema } = await import("@/db");
  const { retrieve } = await import("@/lib/rag");
  const { indexSource, searchIndex } = await import("@/lib/ctx-index");
  const db = getDb();
  const mail = (key: string, subject: string, preview: string, days: number) => db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: "Anna Muster", fromEmail: "a@example.com", subject, preview, receivedAt: ago(days) } as never).run();
  mail("a", "Übergabe Figma", "Die Übergabe der Figma-Nodes ist für Freitag geplant, Navigation inklusive.", 5);
  mail("b", "Mittagessen", "Wollen wir heute zusammen essen gehen?", 1);
  mail("c", "Navigation", "Navigation Navigation Navigation: die Navigation ist fertig.", 9);
  db.insert(schema.teamsMessages).values({ key: "t1", kind: "chat", conversationId: "x", messageId: "1", sentAt: ago(2), html: "", text: "Die Navigationsleiste braucht noch ein Update", link: "l", syncedAt: ago(0), senderName: "Rico Clemen", place: "PROJ Devs" } as never).run();

  assert.equal(indexSource("mails"), 3);
  assert.equal(indexSource("mails"), 0, "nothing twice");
  // Umlauts folded: "uebergabe" isn't it, but "ubergabe" (folded Ü) is found; word beginnings match.
  assert.deepEqual(searchIndex("mails", ["ubergabe"]).map((h) => h.ref), ["a"]);
  assert.deepEqual(searchIndex("mails", ["navig"]).map((h) => h.ref).sort(), ["a", "c"]);
  // The most relevant first: the mail that is all about it.
  assert.equal(searchIndex("mails", ["navigation"])[0].ref, "c");

  const r = await retrieve([{ query: "Navigation Figma", where: ["mails", "teams"] }], { perSource: 3 });
  assert.match(r.text, /\[mail:a\]/);
  assert.match(r.text, /\[teams:t1\]/, "Navigationsleiste: by its beginning");
  assert.doesNotMatch(r.text, /Mittagessen/);

  // New rows are picked up by the next search.
  mail("d", "Release", "Das Release der Navigation ist durch", 0);
  assert.ok(searchIndex("mails", ["release"]).some((h) => h.ref === "d"));
});
