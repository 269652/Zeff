import assert from "node:assert/strict";
import test from "node:test";
import { SEED, dbAll, editor, open, withPage } from "./helpers.mjs";

const TO = "2027-03-05";

test("calendar in a page: an all-day event dragged to another day moves there, and stays after a reload", (t) =>
  withPage(t, async (page) => {
    await open(page, `/workspace/${SEED.calendarPage}`);
    const embed = editor(page).locator('[data-app-block="calendar"]').first();
    // (The all-day row of a day comes before its hours: the first element of that day.)
    const allDay = (day) => embed.locator(`[data-day="${day}"]`).first();
    const item = (day) => allDay(day).locator("[data-item]", { hasText: SEED.calEvent });
    await item(SEED.calEventDay).waitFor({ timeout: 30_000 }).catch(async () => {
      throw new Error(`The embedded calendar doesn't show "${SEED.calEvent}" on ${SEED.calEventDay} (it shows: "${(await embed.innerText().catch(() => "(no calendar block)")).slice(0, 300)}").`);
    });
    const from = await item(SEED.calEventDay).boundingBox();
    const to = await allDay(TO).boundingBox();
    if (!from || !to) throw new Error("The event or the target day has no box on the screen.");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * i) / 10, from.y + from.height / 2, { steps: 2 });
    await page.mouse.up();
    await item(TO).waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error(`After the drag "${SEED.calEvent}" isn't on ${TO}.`);
    });
    // Saved: the database has it on the new day (a server action — a moment).
    for (let i = 0; i < 20 && dbAll("SELECT start FROM calendar_events WHERE calendar_id = ? AND title = ?", SEED.calendarId, SEED.calEvent)[0]?.start !== TO; i++) await page.waitForTimeout(500);
    const [ev] = dbAll("SELECT start, end FROM calendar_events WHERE calendar_id = ? AND title = ?", SEED.calendarId, SEED.calEvent);
    assert.deepEqual(ev, { start: TO, end: "2027-03-06" }, "the event's new day is saved (end: the day after)");
    await open(page, `/workspace/${SEED.calendarPage}`);
    await item(TO).waitFor({ timeout: 30_000 }).catch(() => {
      throw new Error(`After a reload "${SEED.calEvent}" isn't on ${TO} any more.`);
    });
    assert.equal(await item(SEED.calEventDay).count(), 0, `"${SEED.calEvent}" is no longer on ${SEED.calEventDay}`);
  }));
