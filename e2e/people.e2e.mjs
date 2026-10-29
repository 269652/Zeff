import assert from "node:assert/strict";
import test from "node:test";
import { SEED, editor, focusEditorEnd, newPage, rx, withPage } from "./helpers.mjs";

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
