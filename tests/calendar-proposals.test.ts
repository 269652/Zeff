import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Proposed appointments: any calendar can hold them (the day plan's blocks, what an assistant planned in a page) — dashed in the
// calendar's views, blocking no time, never written to Google; each a proposal ("calendar", "event"): accepted it is an
// appointment, dismissed it is gone (and not proposed again).
setupTempData();

test("a proposed appointment: blocks no time, shows as a proposal, is a proposal; accepted, an appointment like any other — dismissed, gone", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("calendar", true);
  const ir = await import("@/lib/calendar/ir");
  const own = ir.zeffCalendar();
  const [walk, swim] = ir.proposeEvents(own.id, [
    { title: "Wandern", start: "2026-11-03T09:00", end: "2026-11-03T12:00" },
    { title: "Schwimmen", start: "2026-11-03T16:00", end: "2026-11-03T17:00" },
  ]);
  assert.deepEqual([walk.proposed, swim.proposed], [true, true]);
  ir.addEvent(own.id, { title: "Zahnarzt", start: "2026-11-03T14:00", end: "2026-11-03T15:00" });

  const { calendarItems, isProposal } = await import("@/plugins/calendar/view-shared");
  const calendars = ir.listCalendars();
  const events = ir.eventsBetween("2026-11-03T00:00", "2026-11-03T23:59", { proposals: true }).map(({ calendar: _c, ...x }) => x);
  const titles = (items: import("@/plugins/calendar/view-shared").Item[]) => items.map((i) => `${i.title}${isProposal(i) ? " (proposed)" : ""}`).sort();
  assert.deepEqual(titles(calendarItems(events, [], calendars, () => true, false)), ["Schwimmen (proposed)", "Wandern (proposed)", "Zahnarzt"], "shown as proposals");
  assert.deepEqual(
    ir.eventsBetween("2026-11-03T00:00", "2026-11-03T23:59").map((e) => e.title),
    ["Zahnarzt"],
    "left out where nothing is planned with them (todos, people, booking …)",
  );
  assert.deepEqual(ir.busyBetween(new Date("2026-11-03T00:00"), new Date("2026-11-03T23:59")).map((b) => b.title), ["Zahnarzt"], "free times: they block nothing");

  // The review queue lists them (source "calendar", kind "event").
  const { openProposals } = await import("@/lib/proposals");
  assert.deepEqual(openProposals("calendar").map((p) => [p.kind, (p.payload as { title: string }).title]).sort(), [["event", "Schwimmen"], ["event", "Wandern"]]);

  const { acceptProposalAction, dismissProposalAction } = await import("@/plugins/calendar/server-actions");
  const r = await acceptProposalAction(walk.id);
  assert.equal(r?.ok, true, String(r && "error" in r ? r.error : ""));
  const kept = ir.eventById(walk.id)!;
  assert.deepEqual([kept.calendarId, kept.start, kept.end, kept.proposed], [own.id, "2026-11-03T09:00", "2026-11-03T12:00", false], "the same appointment, proposed no more");
  assert.equal((await acceptProposalAction(walk.id))?.ok, false, "a real one isn't a proposal");
  assert.equal((await dismissProposalAction(swim.id))?.ok, true);
  assert.equal(ir.eventById(swim.id), null, "dismissed: gone");
  assert.deepEqual(openProposals("calendar"), [], "both decided");
  assert.deepEqual(ir.busyBetween(new Date("2026-11-03T00:00"), new Date("2026-11-03T23:59")).map((b) => b.title).sort(), ["Wandern", "Zahnarzt"], "accepted: it blocks time");

  // Proposed again unchanged: the dismissed one stays out.
  assert.deepEqual(ir.proposeEvents(own.id, [{ title: "Schwimmen", start: "2026-11-03T16:00", end: "2026-11-03T17:00" }]), [], "not proposed twice");

  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const doc = markdownToDoc(`Plan\n\n:::calendar ${own.id} month\n`);
  assert.match(JSON.stringify(doc), new RegExp(`"type":"calendarEmbed","attrs":\\{"calendarId":${own.id},"view":"month"`));
  assert.match(docToMarkdown(doc), new RegExp(`:::calendar ${own.id} month`));
});

test("a Google calendar's proposal stays Zeff's: kept through its sync, changed here (never in Google), and the views show it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("calendar", true);
  const ir = await import("@/lib/calendar/ir");
  const g = ir.ensureCalendar("google:me@example.com", { source: "google", name: "Google" });
  ir.replaceEvents(g.id, [{ key: "g1", title: "Aus Google", start: "2027-02-03T09:00", end: "2027-02-03T10:00" }], { from: "2027-02-01", to: "2027-02-08" });
  const [p] = ir.proposeEvents(g.id, [{ title: "Vorschlag", start: "2027-02-03T11:00", end: "2027-02-03T12:00" }]);
  // Google read again: its own replaced, the proposal kept.
  ir.replaceEvents(g.id, [{ key: "g2", title: "Neu aus Google", start: "2027-02-04T09:00", end: "2027-02-04T10:00" }], { from: "2027-02-01", to: "2027-02-08" });
  assert.deepEqual(ir.eventsBetween("2027-02-01T00:00", "2027-02-08T00:00", { proposals: true }).filter((e) => e.calendarId === g.id).map((e) => e.title), ["Vorschlag", "Neu aus Google"]);
  const { saveEventAction } = await import("@/plugins/calendar/server-actions");
  const r = await saveEventAction({ id: p.id, calendarId: g.id, title: "Vorschlag später", start: "2027-02-03T13:00", end: "2027-02-03T14:00", allDay: false, location: "", description: "" });
  assert.equal(r?.ok, true, String(r && "error" in r ? r.error : ""));
  assert.deepEqual([ir.eventById(p.id)?.title, ir.eventById(p.id)?.proposed], ["Vorschlag später", true], "changed here, still a proposal");
  const { calendarViewData } = await import("@/plugins/calendar/view-data");
  const d = await calendarViewData("week", "2027-02-03");
  assert.equal(d.events.find((e) => e.id === p.id)?.proposed, true, "the calendar app shows it");
});
