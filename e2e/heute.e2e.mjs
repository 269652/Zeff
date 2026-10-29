import assert from "node:assert/strict";
import test from "node:test";
import { SEED, open, rx, withPage } from "./helpers.mjs";

test("today: what is due shows under its heading, a checkbox ticks a todo (done) and ✕ dismisses one — both leave the list", (t) =>
  withPage(t, async (page) => {
    const [tick, dismiss] = SEED.heuteTodos;
    await open(page, "/heute");
    const due = page.getByRole("region", { name: rx("Due and overdue", "Fällig und überfällig", "Vencidas") });
    await due.waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error('Today has no "Due and overdue" section (the seed has two todos due today).');
    });
    assert.ok(await due.getByRole("heading", { level: 2 }).count(), "the section has a heading");

    const box = due.getByRole("checkbox", { name: tick });
    await box.waitFor({ timeout: 15_000 }).catch(async () => {
      throw new Error(`No checkbox for "${tick}" (the section: ${await due.innerText()}).`);
    });
    await box.click();
    await due.getByText(tick).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {
      throw new Error(`Ticking "${tick}" didn't take it off the list.`);
    });

    const row = due.locator("li", { hasText: dismiss });
    await row.getByRole("button", { name: rx("Dismiss", "Verwerfen", "Descartar") }).click();
    await due.getByText(dismiss).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {
      throw new Error(`Dismissing "${dismiss}" didn't take it off the list.`);
    });

    // Gone for good: after a reload neither is due any more.
    await open(page, "/heute");
    for (const text of [tick, dismiss]) assert.equal(await page.getByText(text, { exact: true }).count(), 0, `"${text}" is back after a reload`);
  }));
