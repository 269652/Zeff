import assert from "node:assert/strict";
import test from "node:test";
import { SEED, open, withPage } from "./helpers.mjs";

test("Kennzahlen: the page loads and shows the seeded metrics with their values, without React errors", (t) =>
  withPage(t, async (page) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => m.type() === "error" && /react|hydrat|minified|uncaught/i.test(m.text()) && errors.push(m.text().slice(0, 300)));
    await open(page, "/workspace/metrics");
    for (const m of SEED.metrics) {
      const card = page.locator("main li.card", { hasText: m.label });
      await card.first().waitFor({ timeout: 20_000 }).catch(() => {
        throw new Error(`No card for the Kennzahl "${m.label}".`);
      });
      const text = await card.first().innerText();
      assert.ok(text.includes(m.shown), `"${m.label}" shows ${m.shown} (its card: "${text.slice(0, 200)}")`);
    }
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, [], "no React errors on the page");
  }));
