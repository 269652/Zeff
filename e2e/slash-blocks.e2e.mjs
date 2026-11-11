import assert from "node:assert/strict";
import test from "node:test";
import { editor, focusEditorEnd, newPage, rx, withPage } from "./helpers.mjs";

/** The "/" menu's ready-made blocks: a widget from the library lands as a widget block that runs, a snippet as headings, a colour callout. */
test("slash blocks: a calculator widget, a meeting-notes snippet and a green callout", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("/blocks calc");
    const calc = page.getByRole("option", { name: rx("Calculator", "Taschenrechner") }).first();
    await calc.waitFor({ timeout: 15_000 });
    await calc.click();
    await page.locator(".ws-app-widget").first().waitFor({ timeout: 15_000 });
    assert.equal(await page.locator(".ws-app-widget").count(), 1, "the calculator is on the page as a widget");

    await focusEditorEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/blocks meeting");
    const notes = page.getByRole("option", { name: rx("Meeting notes", "Besprechungsnotizen") }).first();
    await notes.waitFor({ timeout: 15_000 });
    await notes.click();
    await editor(page).getByText(rx("Agenda", "Tagesordnung")).first().waitFor({ timeout: 10_000 });

    await focusEditorEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/success");
    const ok = page.getByRole("option", { name: rx("Success box", "Erfolgs-Box") }).first();
    await ok.waitFor({ timeout: 10_000 });
    await ok.click();
    await editor(page).locator(".ws-callout[data-tone='green']").first().waitFor({ timeout: 10_000 });
  }));
