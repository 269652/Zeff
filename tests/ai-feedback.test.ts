import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const DAY = 864e5;
const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

/** A decision with a key is written once — whoever (the live hook, the backfill) writes it first. */
test("recordFeedback writes a keyed decision once and never throws", async () => {
  const { recordFeedback, listFeedback } = await import("@/lib/learning/ledger");
  assert.equal(recordFeedback({ step: "people-claim", itemRef: "people-claim:1", verdict: "rejected", key: "people-claim:1:rejected" }), true);
  assert.equal(recordFeedback({ step: "people-claim", itemRef: "people-claim:1", verdict: "rejected", key: "people-claim:1:rejected" }), false);
  assert.equal(recordFeedback({ step: "", itemRef: "x", verdict: "accepted" }), false);
  assert.equal(recordFeedback({ step: "x", itemRef: "x", verdict: "nonsense" as never }), false);
  assert.equal(listFeedback({ step: "people-claim" }).length, 1);
});

/** Rates per step over 7/30/90 days: accepted ÷ judged (ignored isn't judged), none below three; the trend against the 30 days before. */
test("the quality report counts each step's verdicts per window", async () => {
  const { recordFeedback } = await import("@/lib/learning/ledger");
  const { qualityReport } = await import("@/lib/learning/quality");
  const r = (verdict: "accepted" | "rejected" | "edited" | "ignored", days: number, i: number) => recordFeedback({ step: "booking", itemRef: `entry:S-${i}`, verdict, at: ago(days) });
  r("accepted", 1, 1);
  r("accepted", 2, 2);
  r("rejected", 3, 3);
  r("ignored", 3, 4);
  r("accepted", 20, 5);
  r("edited", 25, 6);
  // the 30 days before: all rejected
  r("rejected", 40, 7);
  r("rejected", 45, 8);
  r("rejected", 50, 9);
  r("accepted", 120, 10); // outside every window
  const q = qualityReport(NOW);
  const b = q.steps.find((s) => s.step === "booking")!;
  const [w7, w30, w90] = b.windows;
  assert.deepEqual([w7.total, w7.accepted, w7.rejected, w7.ignored], [4, 2, 1, 1]);
  assert.equal(Math.round(w7.rate! * 100), 67);
  assert.equal(w30.total, 6);
  assert.equal(w30.rate, 3 / 5);
  assert.equal(w90.total, 9);
  assert.equal(b.total, 10);
  assert.equal(Math.round(b.trend! * 100), 60, "0.6 now against 0 before");
  // A step with two decisions: no rate yet.
  recordFeedback({ step: "lage", itemRef: "todo:1", verdict: "accepted", at: ago(1) });
  recordFeedback({ step: "lage", itemRef: "todo:2", verdict: "rejected", at: ago(1) });
  assert.equal(qualityReport(NOW).steps.find((s) => s.step === "lage")!.windows[0].rate, null);
});

/** The patterns: the same sender and kind rejected twice or more, the most rejected first, with examples. */
test("the most rejected patterns are grouped by step, sender and kind", async () => {
  const { recordFeedback } = await import("@/lib/learning/ledger");
  const { qualityReport } = await import("@/lib/learning/quality");
  for (let i = 0; i < 3; i++) recordFeedback({ step: "note-review", itemRef: `todo:${100 + i}`, verdict: "rejected", sender: "News@Shop.de", kind: "angebot der woche", detail: { text: `Angebot ${i}` }, at: ago(i + 1) });
  recordFeedback({ step: "note-review", itemRef: "todo:110", verdict: "rejected", sender: "a@b.de", kind: "x", at: ago(1) });
  const p = qualityReport(NOW).patterns.find((x) => x.step === "note-review")!;
  assert.equal(p.sender, "news@shop.de", "senders are kept lowercase");
  assert.equal(p.rejected, 3);
  assert.equal(p.examples.length, 3);
  assert.equal(p.examples[0].text, "Angebot 0");
  assert.equal(qualityReport(NOW).patterns.filter((x) => x.sender === "a@b.de").length, 0, "once is no pattern");
});

test("a subject's stem drops prefixes, numbers, dates and ticket keys", async () => {
  const { subjectStem } = await import("@/lib/learning/rules");
  assert.equal(subjectStem("AW: Ihre Rechnung 2026-10 Nr. 4711"), subjectStem("Ihre Rechnung 2026-11 Nr. 4802"));
  assert.equal(subjectStem("Re: PROJ-12 Build failed on main"), "build failed on main");
});

/** Three rejections of the same sender + kind, none accepted: a proposal with its evidence; fewer, or one accepted, none. */
test("a rule is proposed from repetition only, and only once", async () => {
  const { recordFeedback } = await import("@/lib/learning/ledger");
  const { proposeRules, decideRule, learnedRules } = await import("@/lib/learning/rules");
  const drop = (sender: string, kind: string, i: number, detail: Record<string, unknown> = {}) =>
    recordFeedback({ step: "mail-review", itemRef: `todo:${i}`, verdict: "rejected", sender, kind, sourceRef: `mail:m${i}`, detail: { text: `Todo ${i}`, ...detail }, at: ago(i % 30) });
  drop("promo@shop.de", "newsletter", 1);
  drop("promo@shop.de", "newsletter", 2);
  assert.equal(proposeRules(NOW).length, 0, "two are not enough");
  drop("promo@shop.de", "newsletter", 3);
  // Another sender, three times — but once you kept one.
  drop("chef@firma.de", "status", 4);
  drop("chef@firma.de", "status", 5);
  drop("chef@firma.de", "status", 6);
  recordFeedback({ step: "mail-review", itemRef: "todo:7", verdict: "accepted", sender: "chef@firma.de", kind: "status", at: ago(2) });
  // A must-do mail among them: never a rule.
  drop("lms@firma.de", "pflichtschulung datenschutz", 8);
  drop("lms@firma.de", "pflichtschulung datenschutz", 9);
  drop("lms@firma.de", "pflichtschulung datenschutz", 10, { mustDo: true });
  const proposed = proposeRules(NOW);
  assert.deepEqual(proposed.map((r) => `${r.sender}|${r.kind}`), ["promo@shop.de|newsletter"]);
  assert.equal(proposed[0].evidence.length, 3);
  assert.ok(proposed[0].evidence.some((e) => e.text === "Todo 3"));
  // Dismissed: not proposed again.
  decideRule(proposed[0].id, "dismissed");
  drop("promo@shop.de", "newsletter", 11);
  assert.equal(proposeRules(NOW).length, 0);
  assert.equal(learnedRules({ status: "dismissed" }).length, 1);
});

/** A confirmed rule holds back the same kind from the same sender — never a must-do mail, a chat or a question. */
test("a confirmed mail rule never holds back must-do mails, chats or questions", async () => {
  const { recordFeedback } = await import("@/lib/learning/ledger");
  const { proposeRules, decideRule, learnedRules, mailRuleFor } = await import("@/lib/learning/rules");
  for (let i = 0; i < 3; i++) recordFeedback({ step: "mail-review", itemRef: `todo:${200 + i}`, verdict: "rejected", sender: "lms@corp.com", kind: "reminder course", at: ago(1) });
  const p = proposeRules(NOW).find((r) => r.sender === "lms@corp.com")!;
  decideRule(p.id, "confirmed");
  const rules = learnedRules({ status: "confirmed" });
  const mail = (subject: string, preview = "Hello", folder = "Posteingang") => ({ fromName: "LMS", fromEmail: "LMS@corp.com", subject, preview, folder });
  assert.ok(mailRuleFor(mail("Reminder: course 12"), rules), "same sender, same kind");
  assert.equal(mailRuleFor(mail("Reminder: course 12", "Your mandatory training is overdue — please complete"), rules), null, "must-do");
  assert.equal(mailRuleFor(mail("Reminder: course 12", "Can you join?"), rules), null, "a question");
  assert.equal(mailRuleFor(mail("Reminder: course 12", "hi", "WhatsApp"), rules), null, "a chat");
  assert.equal(mailRuleFor(mail("Reminder: course 12"), rules, { youWrote: true }), null, "a conversation you take part in");
  assert.equal(mailRuleFor(mail("Invoice 12"), rules), null, "another kind");
  assert.equal(mailRuleFor({ ...mail("Reminder: course 12"), fromEmail: "other@corp.com" }, rules), null, "another sender");
});
