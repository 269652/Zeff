import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Heute's "Wartet auf deine Antwort" for Teams: one line per chat, only while the last word isn't yours. */
test("a Teams chat waits for you once — not per message, not after your answer", async () => {
  const { getDb, schema } = await import("@/db");
  const { teamsChatsWaiting } = await import("@/lib/teams/store");
  const now = Date.parse("2026-10-10T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  let n = 0;
  const msg = (conv: string, kind: "pm" | "chat", senderId: string, senderName: string, text: string, h: number, resolved = false) =>
    getDb()
      .insert(schema.teamsMessages)
      .values({ key: `${conv}|${++n}`, kind, conversationId: conv, messageId: String(n), senderId, senderName, place: `Chat with ${senderName}`, sentAt: at(h), html: text, text, link: `https://teams/${conv}/${n}`, syncedAt: at(0), resolvedAt: resolved ? at(0) : null })
      .run();

  // Ben wrote three times, then you answered: nothing waits.
  msg("ben", "pm", "8:ben", "Ben", "Hast du kurz Zeit?", 30);
  msg("ben", "pm", "8:ben", "Ben", "Es geht um das Deployment", 29);
  msg("ben", "pm", "8:ben", "Ben", "Ist dringend", 28);
  msg("ben", "chat", "8:me", "Ich", "Klar, 14 Uhr?", 27);
  // Anna: your question, then two answers of hers — one line, two messages, waiting since the first.
  msg("anna", "chat", "8:me", "Ich", "Wann passt dir die Abnahme?", 10);
  msg("anna", "pm", "8:anna", "Anna", "Morgen ginge", 9);
  msg("anna", "pm", "8:anna", "Anna", "Oder Freitag?", 8);
  // Tom: marked done in Zeff.
  msg("tom", "pm", "8:tom", "Tom", "Danke!", 5, true);

  const w = teamsChatsWaiting(3, now);
  assert.equal(w.length, 1);
  assert.equal(w[0].who, "Anna");
  assert.equal(w[0].count, 2);
  assert.equal(w[0].text, "Oder Freitag?");
  assert.equal(w[0].since, at(9));
});
