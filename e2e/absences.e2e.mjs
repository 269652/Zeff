import assert from "node:assert/strict";
import test from "node:test";
import { open, rx, withPage } from "./helpers.mjs";

test("absences: one added with “Every week until” is listed once a week up to that day", (t) =>
  withPage(t, async (page) => {
    const note = `E2E weekly ${Date.now()}`;
    await open(page, "/settings#absences");
    const form = page.locator("#absences form").first();
    await form.waitFor();
    // Fridays off, four weeks: 7, 14, 21 and 28 May 2027.
    await form.locator("#startDate").fill("2027-05-07");
    await form.locator("#endDate").fill("2027-05-07");
    await form.locator("#repeatUntil").fill("2027-05-28");
    await form.locator("#note").fill(note);
    await form.getByRole("button", { name: rx("Add absence", "Abwesenheit hinzufügen") }).click();
    const rows = page.locator("#absences tr", { hasText: note });
    await rows.nth(3).waitFor({ timeout: 20_000 }).catch(async () => {
      throw new Error(`Not four entries "${note}" listed after adding the weekly absence: ${await rows.count()} (the form says: "${await form.innerText()}").`);
    });
    const starts = (await rows.locator("td:first-child").allInnerTexts()).map((s) => s.trim()).sort();
    assert.deepEqual(starts, ["2027-05-07", "2027-05-14", "2027-05-21", "2027-05-28"], "one entry a week, on the Fridays");
  }));
