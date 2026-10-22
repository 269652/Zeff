import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The mail review's todo you drop or do lands in the ledger right away — with its mail's sender and kind. */
test("closing a mail-review todo by hand records accepted / rejected with the mail's sender", async () => {
  const { getDb, schema } = await import("@/db");
  const { attributed } = await import("@/lib/boards/activity");
  const { addMailTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const now = new Date().toISOString();
  const mail = (key: string, subject: string, preview = "Angebote der Woche") =>
    getDb().insert(schema.emails).values({ key, convId: key, folder: "Posteingang", fromName: "Shop", fromEmail: "News@Shop.de", subject, preview, receivedAt: now, syncedAt: now }).run();
  mail("m1", "Newsletter 41");
  mail("m2", "Newsletter 42");
  const a = attributed("mail", () => addMailTodo({ ticket: "", text: "Newsletter lesen", kind: "other", refs: ["mail:m1"], runId: null }));
  const b = attributed("mail", () => addMailTodo({ ticket: "", text: "Gutschein einlösen", kind: "other", refs: ["mail:m2"], runId: null }));
  attributed("you", () => setTodoStatus(a.id, "dismissed"));
  attributed("you", () => setTodoStatus(b.id, "done"));
  // Not yours: not a verdict.
  const c = attributed("mail", () => addMailTodo({ ticket: "", text: "Etwas anderes tun", kind: "other", refs: ["mail:m2"], runId: null }));
  attributed("lage:3", () => setTodoStatus(c.id, "dismissed"));

  const rows = listFeedback({ step: "mail-review" });
  assert.equal(rows.length, 2);
  const rej = rows.find((r) => r.itemRef === `todo:${a.id}`)!;
  assert.equal(rej.verdict, "rejected");
  assert.equal(rej.sender, "news@shop.de");
  assert.equal(rej.kind, "newsletter");
  assert.equal(rej.sourceRef, "mail:m1");
  assert.equal(rej.detail.mustDo, false);
  assert.equal(rows.find((r) => r.itemRef === `todo:${b.id}`)!.verdict, "accepted");
});

/** The backfill reads the todos' history once: run twice, nothing doubles; live and backfill share the key. */
test("the backfill is idempotent and agrees with the live hook", async () => {
  const { backfillFeedback } = await import("@/lib/learning/backfill");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const before = listFeedback().length;
  backfillFeedback();
  const once = listFeedback().length;
  backfillFeedback();
  assert.equal(listFeedback().length, once);
  assert.equal(once, before, "the live hook wrote these already");
});

/** A booking suggestion: taken over as is is accepted, with your edits is edited, skipped is rejected. */
test("booking suggestions record accepted, edited and skipped", async () => {
  const { suggestEntry, acceptSuggestion, skipSuggestion } = await import("@/lib/work/suggestions");
  const { createJob } = await import("@/lib/jobs");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const { backfillFeedback } = await import("@/lib/learning/backfill");
  const job = createJob({ number: "J-1", name: "Job" }).number;
  const day = new Date().toISOString().slice(0, 10);
  const s1 = suggestEntry({ jobNumber: job, date: day, hours: 1, description: "Fix A", reportedBy: "test" });
  const s2 = suggestEntry({ jobNumber: job, date: day, hours: 2, description: "Fix B", reportedBy: "test" });
  const s3 = suggestEntry({ jobNumber: job, date: day, hours: 3, description: "Fix C", reportedBy: "test" });
  acceptSuggestion(s1.id, {});
  acceptSuggestion(s2.id, { hours: 1.5 });
  skipSuggestion(s3.id);
  const rows = listFeedback({ step: "booking" });
  const v = (id: number) => rows.find((r) => r.itemRef === `entry:S-${id}`)?.verdict;
  assert.deepEqual([v(s1.id), v(s2.id), v(s3.id)], ["accepted", "edited", "rejected"]);
  backfillFeedback();
  assert.equal(listFeedback({ step: "booking" }).length, 3, "the backfill adds nothing the hook wrote");
});

/** People: a claim confirmed or rejected — and the backfill finds what was decided before the ledger. */
test("people claims record their verdicts; old decisions are backfilled once", async () => {
  const { getSqlite } = await import("@/db");
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, reviewClaim } = await import("@/plugins/people/graph");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const { backfillFeedback } = await import("@/lib/learning/backfill");
  const pid = createPerson({ name: "Nadine" });
  addClaim({ personId: pid, kind: "fact", text: "mag Tee", evidence: "„ich mag Tee“", sourceRef: "msg:wa:1" });
  addClaim({ personId: pid, kind: "fact", text: "wohnt in Rom", evidence: "?", sourceRef: "msg:wa:2" });
  const idOf = (text: string) => (getSqlite().prepare("select id from people_claims where text = ?").get(text) as { id: number }).id;
  const id1 = idOf("mag Tee");
  const id2 = idOf("wohnt in Rom");
  reviewClaim(id1, "confirm");
  reviewClaim(id2, "reject");
  const rows = listFeedback({ step: "people-claim" });
  assert.deepEqual(rows.map((r) => r.verdict).sort(), ["accepted", "rejected"]);
  // Decided before the ledger was there: one rejected claim written straight to the table.
  getSqlite().prepare(`insert into people_claims (person_id, kind, text, status, created_at) values (?, 'fact', 'alt', 'rejected', ?)`).run(pid, new Date().toISOString());
  backfillFeedback();
  backfillFeedback();
  assert.equal(listFeedback({ step: "people-claim" }).length, 3);
});

/** An AI field you change by hand is a correction (edited); one you fill while empty isn't. */
test("an AI field corrected by hand is recorded as edited", async () => {
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const { addRow, createPage, setCell } = await import("@/plugins/workspace/store");
  const { setCellByHand } = await import("@/plugins/workspace/ai-feedback");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const ai = { ...newProperty("Zusammenfassung", "ai"), id: "sum" };
  const db = createPage({ kind: "database", title: "Notizen", parentId: null, schema: { titleName: "Name", properties: [ai], views: [newView("Tabelle", "table")] } });
  const a = addRow(db, { title: "A", cells: {} });
  const b = addRow(db, { title: "B", cells: {} });
  setCell(a, "sum", "Die KI meint dies"); // the AI's fill
  setCellByHand(a, "sum", "Eigentlich das");
  setCellByHand(b, "sum", "Neu von mir"); // was empty: no correction
  const rows = listFeedback({ step: "ws-ai-field" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "edited");
  assert.equal(rows[0].itemRef, `page:${a}`);
  assert.equal(rows[0].kind, "Zusammenfassung");
  assert.equal(rows[0].detail.text, "Die KI meint dies");
});
