import assert from "node:assert/strict";
import test from "node:test";
import { nextUp, type NextInput } from "../src/lib/heute-next";

const now = new Date(2026, 9, 12, 16, 30).getTime(); // Mon 12.10.2026, 16:30 local
const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m).toISOString();
const day = (d: number) => {
  const x = new Date(2026, 9, 12 + d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const todo = (id: number, text: string, extra: Partial<{ due: string; flaggedAt: string }> = {}) => ({ id, ref: `T-${id}`, text, due: extra.due ?? null, flaggedAt: extra.flaggedAt ?? null });
const base: NextInput = { now, asking: [], mine: [], meetings: [], unanswered: [], dates: [], hours: null };

/** The most pressing first: a meeting now, an agent asking, overdue, due today, a meeting soon, people waiting, a date, tomorrow, the day to book. */
test("what's next is ranked by how pressing it is", () => {
  const items = nextUp(
    {
      ...base,
      asking: [todo(1, "Welche Datenbank nehmen?")],
      mine: [todo(2, "Angebot schicken", { due: day(-2) }), todo(3, "Rechnung prüfen", { due: day(0) }), todo(4, "Folien vorbereiten", { due: day(1) }), todo(5, "Irgendwann", { due: day(9) })],
      meetings: [
        { subject: "Daily", start: at(16, 15), end: at(16, 45) },
        { subject: "Abnahme", start: at(17, 10), end: at(18) },
        { subject: "Gestern-Meeting", start: at(9), end: at(10) },
      ],
      unanswered: [
        { key: "a", who: "Anna", text: "Uhrzeit?", since: at(8), count: 2, href: "/apps/whatsapp?chat=Anna", source: "WhatsApp" },
        { key: "b", who: "Ben", text: "Kurz Zeit?", since: at(16), count: 1, href: "https://teams/b", source: "Teams" },
      ],
      dates: [
        { key: "n", title: "Nadines Geburtstag", inDays: 4, href: "/personen/1" },
        { key: "x", title: "Weit weg", inDays: 20, href: "" },
      ],
      hours: { booked: 5, target: 8 },
    },
    20,
  );
  assert.deepEqual(
    items.map((i) => i.title),
    ["Daily", "Welche Datenbank nehmen?", "Angebot schicken", "Rechnung prüfen", "Abnahme", "Reply to Anna", "Nadines Geburtstag", "Folien vorbereiten", "Book the day"],
  );
  assert.equal(items[0].detail, "now · until 16:45");
  assert.equal(items.find((i) => i.title === "Reply to Anna")?.detail, "WhatsApp · 2 messages · for 8 h");
  assert.equal(items.find((i) => i.title === "Book the day")?.detail, "5 of 8 h booked");
});

test("a short list: the top ones; nothing pressing, nothing shown", () => {
  assert.equal(nextUp({ ...base, mine: [todo(1, "a", { due: day(-1) }), todo(2, "b", { due: day(-3) }), todo(3, "c", { due: day(0) })] }, 2).map((i) => i.title).join(), "b,a");
  // Before 16:00 the day isn't to book yet; a message from minutes ago isn't waiting long.
  const morning = new Date(2026, 9, 12, 10).getTime();
  assert.deepEqual(nextUp({ ...base, now: morning, hours: { booked: 0, target: 8 }, unanswered: [{ key: "c", who: "Cleo", text: "?", since: new Date(morning - 30 * 60e3).toISOString(), count: 1, href: "", source: "Teams" }] }), []);
});

test("a week with steps left is to close — after the day's booking", () => {
  const items = nextUp({ ...base, hours: { booked: 5, target: 8 }, weeks: [{ key: "2026-W42", title: "Close the week (W42)", open: 3, href: "/?week=2026-W42" }, { key: "2026-W41", title: "Close last week (W41)", open: 0, href: "/?week=2026-W41" }] });
  assert.deepEqual(
    items.map((i) => `${i.title} · ${i.detail}`),
    ["Book the day · 5 of 8 h booked", "Close the week (W42) · 3 steps open"],
  );
});
