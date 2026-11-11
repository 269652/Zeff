import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { editor, focusEditorEnd, newPage, rx, withPage } from "./helpers.mjs";

/**
 * The visual widget editor: a widget pasted as Markdown (the example of three widgets), 🖌 opens it — the sidebar changes to the
 * widget's outline and properties, a text is written in place, an element moved by drag and drop — and saving brings the page tree
 * back, with the widget's script untouched.
 */
const example = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "examples", "widgets-zusammen.md"), "utf8");

test("visual widget editor: edit in place, drag to move, the sidebar follows, save keeps the scripts", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    // The Markdown as pasted from an editor (with the HTML of highlighted code beside it): it becomes widget blocks.
    await page.evaluate((md) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", md);
      dt.setData("text/html", "<div style=\"font-family:monospace\"><span>highlighted</span></div>");
      document.querySelector("main .ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, example);
    const widgets = page.locator(".ws-app-widget");
    await widgets.first().waitFor({ timeout: 20_000 });
    assert.equal(await widgets.count(), 3, "the paste made three widget blocks, not raw text");

    const first = widgets.first();
    await first.hover();
    await first.getByLabel(rx("Edit visually", "Visuell bearbeiten")).first().click();
    // The sidebar: outline and properties instead of the page tree.
    const side = page.locator("[aria-label='Edit the widget'], [aria-label='Das Widget bearbeiten']").first();
    await side.waitFor({ timeout: 15_000 });
    assert.ok(await side.getByText(rx("Outline", "Gliederung")).count(), "the outline shows in the sidebar");
    // Pick the first label (in the canvas' shadow DOM) — the properties follow.
    const canvasLabel = first.locator("label").first();
    await canvasLabel.waitFor();
    await canvasLabel.click();
    await side.getByText(/^<(label|input|b)>$/).first().waitFor({ timeout: 10_000 });

    // Drag the third label before the first (a click on the slider itself changes nothing: it is inert here).
    const labels = first.locator("label");
    assert.equal(await labels.count(), 3);
    const before = await labels.nth(2).innerText();
    const from = await labels.nth(2).boundingBox();
    const to = await labels.nth(0).boundingBox();
    await page.mouse.move(from.x + 10, from.y + 8);
    await page.mouse.down();
    await page.mouse.move(from.x + 24, from.y + 16, { steps: 6 });
    await page.mouse.move(to.x + 30, to.y + 3, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await first.locator("label").nth(0).innerText(), before, "the dragged label is first now");
    // Ctrl+Z brings it back.
    await page.mouse.click(5, 5);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    assert.notEqual(await first.locator("label").nth(0).innerText(), before, "undo put the label back");

    // A text written in place: double-click, type, Enter (the label has a <b> inside too).
    await first.locator("label").nth(0).dblclick({ position: { x: 220, y: 8 } });
    await page.keyboard.press("End");
    await page.keyboard.type(" X1");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    assert.ok((await first.locator("label").nth(0).innerText()).includes("X1"), "the text was written in place");

    // Group: pick the first two with shift, group them — dragging one part now carries both.
    await first.locator("label").nth(0).click({ position: { x: 220, y: 8 } });
    await first.locator("label").nth(1).click({ position: { x: 220, y: 8 }, modifiers: ["Shift"] });
    await side.getByTitle(rx("Group the picked", "Gruppiere")).first().click();
    await page.waitForTimeout(300);
    assert.equal(await first.locator("[data-group]").count(), 1, "a group was made");

    // Save: the page tree is back, the widget still has its script.
    await side.getByRole("button", { name: rx("Save", "Speichern") }).click();
    await side.waitFor({ state: "detached", timeout: 15_000 });
    await page.getByText(rx("Seiten durchsuchen", "Search pages")).first().waitFor({ timeout: 15_000 });
    const frame = first.locator("iframe").first();
    await frame.waitFor();
    const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
    assert.ok(srcdoc.includes("zeff.page.set"), "the widget's script is still in its code");

    // The second widget publishes "Monatsrate" and "Zinskosten", sends "calculated": the editor's Values lists them.
    const second = widgets.nth(1);
    await second.hover();
    await second.getByLabel(rx("Edit visually", "Visuell bearbeiten")).first().click();
    const side2 = page.locator("[aria-label='Edit the widget'], [aria-label='Das Widget bearbeiten']").first();
    await side2.waitFor({ timeout: 15_000 });
    await side2.getByText("Monatsrate").first().waitFor({ timeout: 10_000 });
    assert.ok(await side2.getByText("Zinskosten").count(), "both published values are listed");
    assert.ok(await side2.getByText("calculated").count(), "the message it sends is listed");
    await side2.getByRole("button", { name: rx("Cancel", "Abbrechen") }).click();
  }));
