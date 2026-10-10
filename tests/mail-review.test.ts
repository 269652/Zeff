import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Mails the review doesn't get at all: automatic answers; GitLab's notifications while the Lage reads GitLab itself. */
test("automatic answers and GitLab notifications aren't for the review", async () => {
  const { notForReview } = await import("@/lib/boards/mail-todos");
  const mail = (subject: string, fromEmail = "anna@example.com", preview = "", folder = "Posteingang") => ({ subject, fromEmail, preview, folder });

  assert.ok(notForReview(mail("Automatische Antwort: Live-Deployment der Website"), false));
  assert.ok(notForReview(mail("Automatic reply: Release planning"), false));
  assert.ok(notForReview(mail("Out of Office: Review"), false));
  assert.ok(!notForReview(mail("Abnahme am Freitag — bitte bestätigen"), false));
  // A WhatsApp chat is never filtered (its "subject" is the chat's name).
  assert.ok(!notForReview(mail("Abwesend", "", "", "WhatsApp"), false));

  const note = mail("Re: Shop | Add search filter", "git@git.example.com", "Ben commented: https://git.example.com/group/shop/-/merge_requests/12#note_1 Bitte noch …");
  assert.ok(notForReview(note, true), "the Lage reads the merge request itself");
  assert.ok(!notForReview(note, false), "without the GitLab plugin it's the review's");
  // GitLab's other mails may ask something of you: the review's.
  assert.ok(!notForReview(mail("Your personal access tokens will expire in 7 days or less", "git@git.example.com", "One or more of your personal access tokens will expire …"), true));
});

/** What the review learns from: its todos you dropped and did, with the mail each came from. */
test("the review sees its todos you dropped and did, with their mails", async () => {
  const { getDb, schema } = await import("@/db");
  const { attributed } = await import("@/lib/boards/activity");
  const { addMailTodo, droppedByYou, setTodoStatus } = await import("@/lib/boards/store");
  const { verdictLines } = await import("@/lib/boards/mail-todos");
  const now = new Date().toISOString();
  const email = (key: string, fromName: string, subject: string) =>
    getDb().insert(schema.emails).values({ key, convId: key, folder: "Gmail", fromName, fromEmail: null, subject, preview: "…", receivedAt: now, syncedAt: now }).run();
  email("m1", "Fitness-App", "Bitte handeln: Dein Konto wird bald gelöscht");
  email("m2", "Anna", "Fotos vom Samstag?");
  const t1 = attributed("lage:1", () => addMailTodo({ ticket: "", text: "Bei der Fitness-App anmelden, damit das Konto bleibt", kind: "other", refs: ["mail:m1"], runId: 1 }));
  const t2 = attributed("lage:1", () => addMailTodo({ ticket: "", text: "Anna die Fotos vom Samstag schicken", kind: "other", refs: ["mail:m2"], runId: 1 }));
  attributed("you", () => setTodoStatus(t1.id, "dismissed"));
  attributed("you", () => setTodoStatus(t2.id, "done"));

  const v = verdictLines(droppedByYou());
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0], /Fitness-App anmelden.*aus: Mail von Fitness-App, „Bitte handeln/);
  assert.equal(v.done.length, 1);
  assert.match(v.done[0], /Anna die Fotos.*aus: Mail von Anna/);
});
