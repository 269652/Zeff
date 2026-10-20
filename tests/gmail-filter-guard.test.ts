import assert from "node:assert/strict";
import test from "node:test";
import { filterProblem } from "@/lib/google/gmail-filter-guard";

/**
 * A Gmail filter keeps working for every mail that comes — so it must name something that stays (a sender, a list, a subject, a kind of
 * mail), never only a state of the moment (Gmail's "important", "unread", "in the inbox") or only a stretch of dates. Cleaning up what is
 * there already is what changing mails is for. (An agent once made `is:important after:…` filters to tidy the inbox: every important mail
 * that has come since skipped it.)
 */
test("a filter about what Gmail finds important, or only about dates or the inbox's state, is refused — with what to do instead", () => {
  assert.match(filterProblem({ query: "is:important after:2026/07/01" })!, /gmail_change|existing/i);
  assert.ok(filterProblem({ query: "is:important" }));
  assert.ok(filterProblem({ query: "after:2025/01/01 before:2025/04/01" }), "only dates");
  assert.ok(filterProblem({ query: "-in:sent -in:chats after:2024/12/31 before:2025/04/01" }), "dates and the negation of mail kinds");
  assert.ok(filterProblem({ query: "is:unread" }));
  assert.ok(filterProblem({ query: "in:inbox" }));
  assert.ok(filterProblem({}), "nothing to match is nothing");
  // A sender, a list, a subject, an attachment — whatever they add (dates, read state) — is fine.
  assert.equal(filterProblem({ from: "flink" }), null);
  assert.equal(filterProblem({ from: "notifications@github.com", query: "is:unread" }), null);
  assert.equal(filterProblem({ subject: "Rechnung" }), null);
  assert.equal(filterProblem({ query: 'list:"<hasi.lists.riseup.net>"' }), null);
  assert.equal(filterProblem({ query: "from:amazon.de subject:Bestellung after:2026/01/01" }), null);
  assert.equal(filterProblem({ hasAttachment: true, from: "x" }), null);
  // Every mail with an attachment is a kind that stays: a rule.
  assert.equal(filterProblem({ hasAttachment: true }), null);
});
