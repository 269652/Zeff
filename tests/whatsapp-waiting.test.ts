import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Heute's "Wartet auf deine Antwort" for WhatsApp: people waiting for you — not groups' chatter, WhatsApp's own lines or its account. */
test("a WhatsApp chat waits for you — a group only when something is to you", async () => {
  const { getDb, schema } = await import("@/db");
  const { whatsappChatsWaiting } = await import("@/lib/mail/store");
  const now = Date.parse("2026-10-10T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  let n = 0;
  const msg = (chat: string, from: string, text: string, h: number, flags: { group?: boolean | null; toMe?: boolean | null } = {}) =>
    getDb()
      .insert(schema.emails)
      .values({ key: `wa:${chat}|${++n}`, convId: `wa:${chat}`, folder: "WhatsApp", fromName: from, fromEmail: null, subject: chat, preview: text, receivedAt: at(h), syncedAt: at(0), isGroup: flags.group ?? null, toMe: flags.toMe ?? null })
      .run();

  // A person asking: waits (two messages since your last).
  msg("Natha", "Ich", "Morgen gerne :)", 30);
  msg("Natha", "Natha", "Ok", 20);
  msg("Natha", "Natha", "Uhrzeit?", 19);
  // You answered last.
  msg("Karla", "Karla", "16.10.?", 10);
  msg("Karla", "Ich", "Passt!", 9);
  // WhatsApp's own line after your answer doesn't make it wait.
  msg("Ben", "Ben", "Kommst du?", 8);
  msg("Ben", "Ich", "Ja", 7);
  msg("Ben", "Ben", "‪+49 151 1 wurde in +49 151 2 geändert.‬", 6);
  // A group's announcements and pictures: not to you.
  msg("Party-Infos", "Holger", "[Video] 23-5 Uhr 8€", 5, { group: true, toMe: false });
  msg("Die Sippe", "Christian", "[Bild] Grüße aus Vancouver", 4, { group: true, toMe: false });
  // A group from before Zeff knew (no flags): told by its senders — not to you either.
  msg("Familie", "Johanna", "soo schön", 3);
  // A group where someone answers you: waits.
  msg("Verein", "Ich", "Wer bringt den Grill?", 12, { group: true, toMe: false });
  msg("Verein", "Tom", "Ich, wenn du die Kohle holst", 2, { group: true, toMe: true });
  msg("Verein", "Anna", "Ich bringe Salat", 1, { group: true, toMe: false });
  // WhatsApp's own account.
  msg("WhatsApp", "WhatsApp", "Telefoniere kostenlos so lange du magst", 1);

  const w = whatsappChatsWaiting(7, now);
  assert.deepEqual(
    w.map((c) => c.who),
    ["Verein", "Natha"],
  );
  const verein = w.find((c) => c.who === "Verein")!;
  assert.equal(verein.count, 1, "only what's to you counts in a group");
  assert.equal(verein.text, "Tom: Ich, wenn du die Kohle holst");
  const natha = w.find((c) => c.who === "Natha")!;
  assert.equal(natha.count, 2);
  assert.equal(natha.since, at(20));
});
