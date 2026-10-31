import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Mails the review doesn't get at all: automatic answers; GitLab's notifications while the Lage reads GitLab itself. */
test("automatic answers and GitLab notifications aren't for the review", async () => {
  const { notForReview } = await import("@/lib/todos/mail-todos");
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
  const { attributed } = await import("@/lib/todos/activity");
  const { addMailTodo, droppedByYou, setTodoStatus } = await import("@/lib/todos/store");
  const { verdictLines } = await import("@/lib/todos/mail-todos");
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

/** Mandatory trainings and signatures are recognized by their words — none left to the AI alone. */
test("mandatory trainings and signatures are must-do mails", async () => {
  const { mustDo } = await import("@/lib/todos/mail-todos");
  const mail = (fromName: string, subject: string, preview: string, folder = "Posteingang") => ({ fromName, fromEmail: null, subject, preview, folder });
  // Must-do: a course reminder (also overdue), a compliance training, a signature.
  assert.ok(mustDo(mail("Lernplattform", "Reminder: Course Pending", "You have not yet completed the mandatory 2026: Data Protection training. The deadline was 01.06.2026.")));
  assert.ok(mustDo(mail("Lernplattform", "Reminder: Course Pending", "This is a reminder that you have not yet completed the course Sustainability 2025. The deadline for course completion was 30.11.2025.")));
  assert.ok(mustDo(mail("HR", "Erinnerung: Pflichtschulung Arbeitsschutz", "Bitte absolviere die Pflichtschulung bis zum 31.10.")));
  assert.ok(mustDo(mail("Compliance", "Reminder - Global Compliance Trainings", "Please complete your compliance trainings by Friday.")));
  assert.ok(mustDo(mail("Ben über Adobe Acrobat Sign", "Erinnerung: Warten auf deine Signatur von Vertrag", "Bitte signiere Vertrag. Hier klicken, um Vertrag zu prüfen und zu signieren.")));
  // Not: an enrollment, a voluntary offer, a newsletter, a chat.
  assert.ok(!mustDo(mail("Lernplattform", "Course Enrollment: AI Coffee Talk", "You have been enrolled in the session AI Coffee Talk.")));
  assert.ok(!mustDo(mail("Anbieter", "Neue Termine für die Ersthelferausbildung", "Melden Sie sich jetzt für einen der neuen Termine an.")));
  assert.ok(!mustDo(mail("Fitness", "Fit in den Herbst: Noch mehr Vielfalt für Dein Training", "Jetzt neue Kurse entdecken.")));
  assert.ok(!mustDo(mail("Anna", "Pflichtschulung", "Hast du die Pflichtschulung schon gemacht? Erinnerung an morgen", "WhatsApp")));
});

/** The must-do mails the AI left out get a todo from Zeff; one it answered, or an open todo has, doesn't. */
test("a must-do mail the AI left out gets a todo, once per course", async () => {
  const { mustDoLeftOut } = await import("@/lib/todos/mail-todos");
  const m = (key: string, preview: string) => ({ key, fromName: "Lernplattform", fromEmail: null, subject: "Reminder: Course Pending", preview, folder: "Posteingang" });
  const a1 = m("a1", "You have not yet completed the mandatory course Data Protection 2026. The deadline was 01.06.2026.");
  const a2 = m("a2", "You have not yet completed the mandatory course Data Protection 2026. The deadline was 01.06.2026.");
  const b = m("b", "You have not yet completed the mandatory course Anti Bribery 2026. The deadline was 01.06.2026.");
  const c = m("c", "You have not yet completed the mandatory course Security Basics. The deadline is 31.10.2026.");
  const other = { key: "x", fromName: "Anna", fromEmail: null, subject: "Fotos?", preview: "Schickst du mir die Fotos?", folder: "Posteingang" };
  const all = [a1, a2, b, c, other];
  const mailOf = (k: string) => all.find((x) => x.key === k);

  // The AI answered c; an open todo has an earlier reminder of b.
  const open = [{ refs: ["mail:b"] }] as unknown as import("@/lib/todos/shared").TodoView[];
  const left = mustDoLeftOut([a1, a2, c, other], new Set(["c"]), open, mailOf);
  assert.equal(left.length, 1, "a1 and a2 are the same course: one todo");
  assert.deepEqual(left[0].mails.map((x) => x.key), ["a1", "a2"]);
  assert.match(left[0].text, /^Pflicht aus Mail erledigen: „Reminder: Course Pending“ — .*Data Protection 2026/);
  // The next reminder of b (same subject and words as the open todo's mail): nothing new.
  assert.equal(mustDoLeftOut([{ ...b, key: "b2" }], new Set(), open, mailOf).length, 0);
});

/** A company's banner before a must-do mail's text ("External to the Groupe …", "<Name> Groupe") is cut off the todo — any company's, none named. */
test("a must-do todo's text starts with the mail's own words, not the company's banner", async () => {
  const { mustDoLeftOut } = await import("@/lib/todos/mail-todos");
  const m = (key: string, preview: string) => ({ key, fromName: "Lernplattform", fromEmail: null, subject: "Reminder: Course Pending", preview, folder: "Posteingang" });
  for (const banner of ["Acme Groupe ", "Muster Groupe ", "External to the Groupe / en provenance de l'extérieur. "]) {
    const x = m("k", `${banner}You have not yet completed the mandatory course Security 2026.`);
    const left = mustDoLeftOut([x], new Set(), [], () => x);
    assert.match(left[0].text, /— You have not yet completed/, banner);
  }
});
