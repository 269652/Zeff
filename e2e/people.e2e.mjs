import assert from "node:assert/strict";
import test from "node:test";
import { SEED, editor, focusEditorEnd, newPage, open, rx, withPage } from "./helpers.mjs";

test("person widget: its person setting suggests people as you type, and a pick writes the full name", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    // The widgets join the slash menu once the editor has loaded their catalog (a server action — slow on a cold server): a menu
    // opened before that doesn't get them, so it is opened again.
    const item = page.getByRole("option", { name: rx("Todos with a person", "Todos mit einer Person") }).first();
    for (let i = 0; ; i++) {
      await page.keyboard.type("/todos");
      if (await item.waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
      if (i === 4) throw new Error('The slash menu has no "Todos with a person" widget after 25 s (is the People plugin installed?).');
      await page.keyboard.press("Escape");
      for (let k = 0; k < "/todos".length; k++) await page.keyboard.press("Backspace");
    }
    await item.click();
    const widget = editor(page).locator(".node-zeffWidget").first();
    await widget.waitFor();
    await widget.hover();
    await widget.getByRole("button", { name: rx("Settings", "Einstellungen") }).click();
    const input = widget.getByRole("combobox", { name: /Person/ });
    await input.waitFor();
    const first = SEED.personName.split(" ")[0];
    await input.click();
    await input.pressSequentially(first.slice(0, 3), { delay: 50 });
    const option = page.getByRole("option", { name: SEED.personName });
    await option.waitFor({ timeout: 10_000 }).catch(() => {
      throw new Error(`Typing "${first.slice(0, 3)}" in the person setting suggested no "${SEED.personName}".`);
    });
    await input.press("Enter");
    await page.waitForFunction((el) => el.value !== el.dataset.before, await input.elementHandle()).catch(() => {});
    assert.equal(await input.inputValue(), SEED.personName, "a pick writes the full name");
  }));

test("person widget: its todos are ticked by a checkbox (done) and dismissed by ✕ — both leave the list", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    const item = page.getByRole("option", { name: rx("Todos with a person", "Todos mit einer Person") }).first();
    for (let i = 0; ; i++) {
      await page.keyboard.type("/todos");
      if (await item.waitFor({ timeout: 5000 }).then(() => true, () => false)) break;
      if (i === 4) throw new Error('The slash menu has no "Todos with a person" widget after 25 s.');
      await page.keyboard.press("Escape");
      for (let k = 0; k < "/todos".length; k++) await page.keyboard.press("Backspace");
    }
    await item.click();
    const widget = editor(page).locator(".node-zeffWidget").first();
    await widget.waitFor();
    await widget.hover();
    await widget.getByRole("button", { name: rx("Settings", "Einstellungen") }).click();
    const input = widget.getByRole("combobox", { name: /Person/ });
    await input.click();
    await input.pressSequentially(SEED.personName.slice(0, 3), { delay: 50 });
    await page.getByRole("option", { name: SEED.personName }).click();
    await widget.getByRole("button", { name: rx("Done", "Erledigt", "Fertig") }).click().catch(() => {});
    const [call, book] = SEED.todos;
    const box = widget.getByRole("checkbox", { name: call });
    await box.waitFor({ timeout: 15_000 }).catch(async () => {
      throw new Error(`The widget shows no checkbox for "${call}" (its rows: ${await widget.innerText()}).`);
    });
    await box.click();
    await widget.getByText(call).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {
      throw new Error(`Ticking "${call}" didn't take it off the list.`);
    });
    const row = widget.locator("li", { hasText: book });
    // (Its buttons show on hover or when focused — by keyboard here.)
    const dismiss = row.getByRole("button", { name: rx("Dismiss", "Verwerfen") });
    await dismiss.focus();
    await dismiss.press("Enter");
    await widget.getByText(book).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {
      throw new Error(`Dismissing "${book}" didn't take it off the list.`);
    });
  }));

test("a page's checklist goes into its todos widget: the item shows once (in the widget), the list folded to a note", (t) =>
  withPage(t, async (page) => {
    await open(page, `/workspace/${SEED.mergePage}`);
    const widget = editor(page).locator(".node-zeffWidget").first();
    await widget.getByRole("checkbox", { name: SEED.mergeItem }).waitFor({ timeout: 15_000 }).catch(async () => {
      throw new Error(`The widget doesn't show the checklist's todo "${SEED.mergeItem}" (it shows: ${await widget.innerText()}).`);
    });
    const list = editor(page).locator('ul[data-type="taskList"]').first();
    assert.equal(await list.isVisible(), false, "the checklist itself is folded (its todo is in the widget)");
    await editor(page).locator(".ws-list-merged-note").first().waitFor({ timeout: 5000 });
    const shown = await editor(page).getByText(SEED.mergeItem).evaluateAll((els) => els.filter((el) => el.checkVisibility()).length);
    assert.equal(shown, 1, "the todo's text once on the screen");
  }));
