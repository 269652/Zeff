import assert from "node:assert/strict";
import test from "node:test";
import { editor, focusEditorEnd, newPage, open, rx, waitSaved, withPage } from "./helpers.mjs";

test("workspace: a new page keeps its title and paragraph across a reload", (t) =>
  withPage(t, async (page) => {
    const id = await newPage(page);
    const title = `E2E page ${Date.now()}`;
    await page.getByRole("textbox", { name: rx("Title", "Titel") }).fill(title);
    await waitSaved(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Ein Absatz aus dem Smoke-Test.");
    await waitSaved(page);
    await open(page, `/workspace/${id}`);
    await editor(page).getByText("Ein Absatz aus dem Smoke-Test.").waitFor();
    // The title shows in the breadcrumb (the big one stays folded once set) or as the title itself.
    assert.ok((await page.locator("main").getByText(title).count()) > 0 || (await page.getByRole("textbox", { name: rx("Title", "Titel") }).inputValue()) === title, `title "${title}" not shown after the reload`);
  }));
