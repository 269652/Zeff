import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What an AI proposes as actions: complete ones kept (cleaned), unknown or incomplete dropped, at most six. */
test("the AI's proposed actions are cleaned", async () => {
  const { cleanActions } = await import("@/plugins/actions/catalog");
  const ops = cleanActions(
    [
      { type: "whatsapp-message", chat: " Natha ", body: " Morgen um 15 Uhr? " },
      { type: "whatsapp-message", chat: "", body: "kein Chat" },
      { type: "keep-note", title: "Einkauf", text: "- [ ] Milch" },
      { type: "gmail-compose", to: "a@b.de", subject: "Re: x", body: "" },
      { type: "rm-rf", path: "/" },
      "nonsense",
    ],
    { ticket: "KB-1" },
  );
  assert.deepEqual(
    ops.map((o) => o.type),
    ["whatsapp-message", "keep-note"],
  );
  assert.deepEqual(ops[0], { type: "whatsapp-message", chat: "Natha", body: "Morgen um 15 Uhr?" });
  assert.equal(cleanActions(Array.from({ length: 10 }, () => ({ type: "keep-note", title: "t", text: "x" })), { ticket: "" }).length, 6);
  assert.deepEqual(cleanActions("not a list", { ticket: "" }), []);
});

test("a deadline is a real day or nothing", async () => {
  const { dueDay } = await import("@/lib/boards/shared");
  assert.equal(dueDay("2026-10-21"), "2026-10-21");
  assert.equal(dueDay(" 2026-10-21 "), "2026-10-21");
  assert.equal(dueDay("21.10.2026"), null);
  assert.equal(dueDay("2026-13-45"), null);
  assert.equal(dueDay(undefined), null);
});

/** WhatsApp's chat list times — today's clock time, weekdays, dates in German and US form. */
test("WhatsApp list times are read", async () => {
  const { parseWhen } = await import("../src/plugins/whatsapp/driver.mjs");
  const now = new Date(2026, 9, 10, 18, 0); // Saturday, 10 Oct 2026
  const day = (iso: string | null) => (iso ? new Date(iso).toDateString() : null);
  assert.equal(new Date(parseWhen("15:45", now, "de")!).getHours(), 15);
  assert.equal(day(parseWhen("Gestern", now, "de")), new Date(2026, 9, 9).toDateString());
  assert.equal(day(parseWhen("Freitag", now, "de")), new Date(2026, 9, 9).toDateString());
  assert.equal(day(parseWhen("Samstag", now, "de")), new Date(2026, 9, 3).toDateString());
  assert.equal(day(parseWhen("09.10.2026", now, "de")), new Date(2026, 9, 9).toDateString());
  assert.equal(day(parseWhen("10/9/26", now, "en-US")), new Date(2026, 9, 9).toDateString());
  assert.equal(parseWhen("Archived", now, "en"), null);
});

test("the Auswerten settings fall back to their defaults and stay in range", async () => {
  const { withDefaults } = await import("@/lib/boards/context-prefs-shared");
  const p = withDefaults({ lage: { numbers: { chatDays: 999 }, sources: { teams: false } } });
  assert.equal(p.lage.numbers.chatDays, 30);
  assert.equal(p.lage.sources.teams, false);
  assert.equal(p.lage.sources.mail, true);
  assert.equal(p.mailtodos.numbers.days, 14);
  assert.equal(p.presync.sources.jira, true);
});
