import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("recordEvent: once per (source, source_ref) — the second time nothing new, its refs kept once", async () => {
  const { recordEvent, eventsFor } = await import("@/plugins/timeline/store");
  const a = recordEvent({ at: "2026-10-01T09:00:00.000Z", kind: "mail", source: "mail", sourceRef: "k1", title: "Angebot", summary: "Das Angebot …", refs: ["person:1", "ticket:PROJ-1", "person:1"] });
  const b = recordEvent({ at: "2026-10-01T09:00:00.000Z", kind: "mail", source: "mail", sourceRef: "k1", title: "Angebot", refs: ["person:1"] });
  assert.ok(a.created);
  assert.equal(b.created, false);
  assert.equal(a.id, b.id);
  // The same source_ref of another source is another event.
  assert.ok(recordEvent({ at: "2026-10-01T10:00:00.000Z", kind: "message", source: "teams", sourceRef: "k1", title: "Hallo", refs: ["person:1"] }).created);
  const got = eventsFor("person:1");
  assert.equal(got.length, 2);
  assert.deepEqual(got[1].refs, ["person:1", "ticket:PROJ-1"]);
});

test("eventsFor: newest first, since/until, kinds by prefix, sources, limit", async () => {
  const { recordEvent, eventsFor, eventsBetween, eventCounts } = await import("@/plugins/timeline/store");
  const ref = "ticket:ORD-7";
  recordEvent({ at: "2026-09-01T08:00:00.000Z", kind: "ticket.created", source: "jira", sourceRef: "ORD-7:created", title: "ORD-7 angelegt", refs: [ref] });
  recordEvent({ at: "2026-09-03T08:00:00.000Z", kind: "comment", source: "jira", sourceRef: "c9", title: "Kommentar", refs: [ref] });
  recordEvent({ at: "2026-09-05T08:00:00.000Z", kind: "ticket.status", source: "jira", sourceRef: "ORD-7:status:Done", title: "Done", refs: [ref] });
  recordEvent({ at: "2026-09-04T08:00:00.000Z", kind: "time", source: "time", sourceRef: "e1", title: "2 h", refs: [ref] });
  assert.deepEqual(eventsFor(ref).map((e) => e.kind), ["ticket.status", "time", "comment", "ticket.created"]);
  assert.deepEqual(eventsFor(ref, { since: "2026-09-03T08:00:00.000Z" }).map((e) => e.kind), ["ticket.status", "time", "comment"]);
  assert.deepEqual(eventsFor(ref, { until: "2026-09-03T08:00:00.000Z" }).map((e) => e.kind), ["comment", "ticket.created"]);
  assert.deepEqual(eventsFor(ref, { kinds: ["ticket"] }).map((e) => e.kind), ["ticket.status", "ticket.created"]);
  assert.deepEqual(eventsFor(ref, { sources: ["time"] }).map((e) => e.kind), ["time"]);
  assert.equal(eventsFor(ref, { limit: 1 }).length, 1);
  // Several refs at once (a row and its person): each event once.
  recordEvent({ at: "2026-09-06T08:00:00.000Z", kind: "mail", source: "mail", sourceRef: "both", title: "both", refs: [ref, "page:5"] });
  assert.equal(eventsFor([ref, "page:5"]).filter((e) => e.sourceRef === "both").length, 1);
  assert.deepEqual(eventsBetween("2026-09-03T00:00:00.000Z", "2026-09-04T23:59:59.000Z").map((e) => e.kind), ["time", "comment"]);
  const c = eventCounts(ref);
  assert.equal(c.total, 5);
  assert.equal(c.byKind["ticket.status"], 1);
  assert.equal(eventCounts(ref, { since: "2026-09-05T00:00:00.000Z" }).total, 2);
});

test("changesSince: what happened since a date, grouped by the entity it concerns — the busiest first, the event's own identity left out", async () => {
  const { recordEvent, changesSince } = await import("@/plugins/timeline/store");
  recordEvent({ at: "2026-10-10T08:00:00.000Z", kind: "mail", source: "mail", sourceRef: "g1", title: "a", refs: ["mail:g1", "person:42", "ticket:GRP-1"] });
  recordEvent({ at: "2026-10-11T08:00:00.000Z", kind: "message", source: "whatsapp", sourceRef: "g2", title: "b", refs: ["msg:whatsapp:g2", "person:42"] });
  recordEvent({ at: "2026-10-01T08:00:00.000Z", kind: "message", source: "whatsapp", sourceRef: "g0", title: "old", refs: ["person:42"] });
  const groups = changesSince("2026-10-09T00:00:00.000Z");
  const p = groups.find((g) => g.ref === "person:42")!;
  assert.equal(p.count, 2);
  assert.equal(p.events[0].title, "b");
  assert.ok(groups.some((g) => g.ref === "ticket:GRP-1"));
  assert.ok(!groups.some((g) => g.ref.startsWith("mail:") || g.ref.startsWith("msg:")));
  assert.ok(groups.indexOf(p) < groups.findIndex((g) => g.ref === "ticket:GRP-1"));
});

test("last seen: per ref, the marker of what is new", async () => {
  const { lastSeen, markSeen } = await import("@/plugins/timeline/store");
  assert.equal(lastSeen("person:42"), null);
  markSeen("person:42", "2026-10-12T00:00:00.000Z");
  assert.equal(lastSeen("person:42"), "2026-10-12T00:00:00.000Z");
  assert.equal(lastSeen("person:43"), null);
});
