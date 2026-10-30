import assert from "node:assert/strict";
import test from "node:test";
import { SEED, editor, open, rx, waitSaved, withPage } from "./helpers.mjs";

/** The Templates of the tree (folded open). */
async function templatesTree(page) {
  const section = page.getByRole("region", { name: rx("Templates", "Vorlagen") }).first();
  await section.waitFor();
  const fold = section.getByRole("button", { name: rx("Templates", "Vorlagen") }).first();
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  return section;
}

test("templates: your own is in the Templates of the tree, not among the pages; a built-in one opens read only", (t) =>
  withPage(t, async (page) => {
    await open(page, "/workspace");
    const section = await templatesTree(page);
    await section.getByRole("link", { name: SEED.ownTemplateTitle }).waitFor({ timeout: 10_000 }).catch(() => {
      throw new Error(`The seeded template "${SEED.ownTemplateTitle}" is not in the Templates of the tree.`);
    });
    const pages = page.locator("section", { has: page.getByRole("heading", { name: rx("Pages", "Seiten"), exact: true }) }).first();
    assert.equal(await pages.getByRole("link", { name: SEED.ownTemplateTitle }).count(), 0, "not among the pages");

    const builtin = section.getByRole("button", { name: rx("Built-in", "Mitgeliefert") });
    if ((await builtin.getAttribute("aria-expanded")) !== "true") await builtin.click();
    await section.locator('a[href="/workspace/templates/meeting"]').click();
    await page.waitForURL(/\/workspace\/templates\/meeting$/, { timeout: 30_000 });
    await page.locator("[data-builtin-bar]").getByText(rx("read only", "nur lesen")).waitFor();
    await editor(page).waitFor();
    assert.equal(await editor(page).getAttribute("contenteditable"), "false", "the built-in template can't be edited");
  }));

test("templates: a built-in one duplicated is a template of yours (editable, opened) — and New from a template lists it", (t) =>
  withPage(t, async (page) => {
    await open(page, "/workspace/templates/meeting");
    await page.getByRole("button", { name: rx("Duplicate as my template", "Als meine Vorlage duplizieren") }).click();
    await page.waitForURL(/\/workspace\/\d+$/, { timeout: 30_000 }).catch(() => {
      throw new Error("Duplicate as my template didn't open the new template.");
    });
    await page.locator("[data-template-bar]").waitFor();
    assert.equal(await editor(page).getAttribute("contenteditable"), "true", "your own template is a page you edit");
    const name = `E2E Vorlage ${Date.now()}`;
    await page.getByRole("textbox", { name: rx("Title", "Titel") }).fill(name);
    await waitSaved(page);

    await open(page, "/workspace");
    const section = await templatesTree(page);
    await section.getByRole("link", { name }).waitFor({ timeout: 10_000 });

    await page.getByTitle(/^(New|Neu)$/).first().click();
    await page.getByRole("menuitem", { name: rx("From a template", "Aus einer Vorlage") }).click();
    const card = page.getByRole("button", { name: rx(`Make “${name}”`, `„${name}“ anlegen`, `“${name}” anlegen`) });
    await card.waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error(`"New from a template" doesn't list the new template "${name}".`);
    });
    assert.equal(await page.getByRole("button", { name: new RegExp(SEED.ownTemplateTitle) }).count() > 0, true, "the seeded template is listed too");
    await card.click();
    await page.waitForURL(/\/workspace\/\d+$/, { timeout: 30_000 });
    assert.equal(await page.locator("[data-template-bar]").count(), 0, "the page made of it is a normal page");
  }));
