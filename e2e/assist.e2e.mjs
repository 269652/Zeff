import assert from "node:assert/strict";
import test from "node:test";
import { SEED, dbAll, editor, fakeAnswer, open, rx, waitSaved, withPage } from "./helpers.mjs";

/** The fake model's answers: a round of questions, then a proposal (a plan calendar and a todo). */
const ASK = {
  intent: "Hamburg-Reise",
  summary: "Ein Besuch in Hamburg im März 2027.",
  questions: [{ id: "q1", text: "Wie lange bleibst du?", kind: "choice", options: ["Zwei Tage", "Fünf Tage"] }],
  actions: [],
};
const CAL_NAME = "E2E Hamburg-Plan";
const TODO = "E2E Zug nach Hamburg buchen";
const PROPOSE = {
  intent: "Hamburg-Reise",
  summary: "Zwei Tage Hamburg im März 2027.",
  questions: [],
  actions: [
    { kind: "shadowCalendar", label: "Plan für Hamburg", name: CAL_NAME, events: [{ title: "Hamburg", start: "2027-03-12", end: "2027-03-14", allDay: true }] },
    { kind: "todo", label: "Zug buchen", text: TODO },
  ],
};

/** Think along about the block the caret is in: the caret into the paragraph, Ctrl+Shift+Space opens the composer, Enter (nothing typed) thinks along. */
async function thinkAlong(page) {
  await editor(page).getByText(SEED.assistText).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Shift+Space");
  const composer = page.getByRole("dialog", { name: /Zeff/ });
  await composer.getByRole("textbox").waitFor();
  await page.keyboard.press("Enter");
  await composer.waitFor({ state: "detached" });
}

test("think along: a question, then a proposal; Apply puts a calendar and a checklist in; ✨ again re-thinks the same card, no second calendar", (t) =>
  withPage(t, async (page) => {
    fakeAnswer(ASK);
    await open(page, `/workspace/${SEED.assistPage}`);
    await thinkAlong(page);
    const cards = editor(page).locator(".ws-assist");
    const card = cards.first();
    await card.getByText(ASK.questions[0].text).waitFor({ timeout: 60_000 }).catch(async () => {
      throw new Error(`The card didn't ask the fake model's question (cards: ${await cards.count()}, it shows: "${(await card.innerText().catch(() => "(no card)")).slice(0, 300)}").`);
    });
    await card.locator("label", { hasText: "Zwei Tage" }).click();
    fakeAnswer(PROPOSE);
    await card.getByRole("button", { name: rx("Continue", "Weiter") }).click();
    const apply = card.getByRole("button", { name: rx("Apply", "Übernehmen") });
    await apply.waitFor({ timeout: 60_000 }).catch(async () => {
      throw new Error(`No proposal after Continue (the card shows: "${(await card.innerText()).slice(0, 300)}").`);
    });
    await card.getByText(TODO).first().waitFor();
    await apply.click();
    await editor(page).locator(".ws-assist-done").waitFor({ timeout: 30_000 }).catch(async () => {
      throw new Error(`Apply didn't finish (the card shows: "${(await card.innerText()).slice(0, 300)}").`);
    });
    const calendars = editor(page).locator('[data-app-block="calendar"]');
    await calendars.first().waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error("Apply put no calendar block into the page.");
    });
    const list = editor(page).locator('ul[data-type="taskList"]', { hasText: TODO });
    await list.first().waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error(`Apply put no checklist with "${TODO}" into the page.`);
    });
    await waitSaved(page);
    const [cal] = dbAll("SELECT id FROM calendars WHERE name = ?", CAL_NAME);
    assert.ok(cal, `no plan calendar "${CAL_NAME}" in the database after Apply`);

    // ✨ again on the same block: the card that is there thinks again (it knows the calendar it made: the model updates it).
    fakeAnswer({ ...PROPOSE, actions: [{ kind: "shadowCalendar", label: "Plan für Hamburg", name: CAL_NAME, calendarId: cal.id, events: [{ title: "Hamburg", start: "2027-03-19", end: "2027-03-21", allDay: true }] }] });
    await thinkAlong(page);
    await apply.waitFor({ timeout: 60_000 }).catch(async () => {
      throw new Error(`✨ again didn't bring a new proposal into the card (cards: ${await cards.count()}, the first shows: "${(await card.innerText()).slice(0, 300)}").`);
    });
    assert.equal(await cards.count(), 1, "✨ again re-thinks the same card — no second card");
    await apply.click();
    await editor(page).locator(".ws-assist-done").waitFor({ timeout: 30_000 });
    await waitSaved(page);
    assert.equal(await calendars.count(), 1, "applying again updates the plan calendar — no second calendar block");
    assert.equal(dbAll("SELECT id FROM calendars WHERE name = ?", CAL_NAME).length, 1, "no second plan calendar in the database");
    const days = dbAll("SELECT start FROM calendar_events WHERE calendar_id = ?", cal.id).map((e) => e.start);
    assert.deepEqual(days, ["2027-03-19"], `the plan calendar's days were replaced (it has: ${days.join(", ")})`);

    // Reloaded: still one card, one calendar, one checklist.
    await open(page, `/workspace/${SEED.assistPage}`);
    await calendars.first().waitFor();
    assert.equal(await cards.count(), 1, "one card after a reload");
    assert.equal(await calendars.count(), 1, "one calendar block after a reload");
    assert.equal(await editor(page).locator('ul[data-type="taskList"]').count(), 1, "one checklist after a reload");
  }));
