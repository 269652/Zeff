import assert from "node:assert/strict";
import test from "node:test";
import { editor, focusEditorEnd, newPage, rx, withPage } from "./helpers.mjs";

/** Type "/<query>" in the editor and pick the slash menu's option whose text matches. */
async function slash(page, query, option) {
  await page.keyboard.type(`/${query}`);
  const item = page.getByRole("option", { name: option }).first();
  await item.waitFor({ timeout: 15_000 }).catch(() => {
    throw new Error(`The slash menu didn't offer ${option} for "/${query}".`);
  });
  await item.click();
}

test("slash menu: a flex row has two columns, and a column takes text", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    await slash(page, "flex", rx("Flex row", "Flex-Zeile"));
    const flex = editor(page).locator(".ws-flex[data-dir='row']").first();
    await flex.waitFor();
    const cols = flex.locator(":scope > .ws-flex-body .ws-flex[data-dir='col']");
    assert.equal(await cols.count(), 2, "a flex row starts with two columns");
    await cols.nth(1).locator("p").first().click();
    await page.keyboard.type("Rechte Spalte");
    await cols.nth(1).getByText("Rechte Spalte").waitFor();
    assert.equal(await cols.nth(0).getByText("Rechte Spalte").count(), 0, "the text went into the second column, not the first");
  }));

test("inline formula: {= opens the box, 1+2 Enter is a chip showing 3, a click opens it again, Backspace removes it", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Summe: ");
    await page.keyboard.type("{=");
    const box = page.locator("main input.font-mono").first();
    await box.waitFor({ timeout: 10_000 }).catch(() => {
      throw new Error('Typing "{=" didn\'t open the formula box.');
    });
    // Typed as fast as a keyboard goes: what is lost on the way is a bug of its own (reported at the end, after the rest of the
    // flow was checked with the formula filled in).
    await page.keyboard.type("1+2");
    await page.waitForTimeout(500);
    const typed = await box.inputValue();
    const lost = typed === "1+2" ? null : `Keystrokes typed into the formula box were lost: typed "1+2" (no delay), the box has "${typed}".`;
    if (lost) {
      // One key at a time, each waited for until the box has it.
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForFunction((el) => el.value === "", await box.elementHandle());
      let want = "";
      for (const ch of "1+2") {
        want += ch;
        await page.keyboard.type(ch);
        await page.waitForFunction((args) => args[0].value === args[1], [await box.elementHandle(), want], { timeout: 3000 }).catch(async () => {
          throw new Error(`${lost} Typed one key at a time it still lost "${ch}" (box: "${await box.inputValue()}").`);
        });
        await page.waitForTimeout(300);
      }
    }
    await page.waitForTimeout(300);
    await box.press("Enter");
    const chip = editor(page).locator(".ws-iformula-value").first();
    await chip.filter({ hasText: /^\s*3\s*$/ }).waitFor({ timeout: 5000 }).catch(async () => {
      throw new Error(`The chip doesn't show 3 but "${await chip.innerText().catch(() => "(no chip)")}".`);
    });
    await assert.doesNotReject(box.waitFor({ state: "detached", timeout: 5000 }), "the box closes after Enter");
    await chip.click();
    await box.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error("A click on the chip didn't open the formula box again.");
    });
    assert.equal(await box.inputValue(), "1+2", "the box shows the formula");
    await box.press("Escape");
    await box.waitFor({ state: "detached", timeout: 5000 });
    // The caret is after the chip: select it (←, or it is selected by Backspace first) and remove it with Backspace.
    await page.keyboard.press("Backspace");
    if (await chip.count()) await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    assert.equal(await editor(page).locator(".ws-iformula-value").count(), 0, "Backspace on the selected chip removes it");
    await editor(page).getByText("Summe:").waitFor();
    if (lost) throw new Error(lost);
  }));

test("page table: a number stands right (ws-num-cell), =A2*2 shows 24", (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    await slash(page, "tab", rx("Rows and columns", "Zeilen und Spalten"));
    const table = editor(page).locator("table").first();
    await table.waitFor();
    // The caret is in the header's first cell: three Tabs to A2.
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    await page.keyboard.type("12");
    await page.keyboard.press("Tab");
    await page.keyboard.type("=A2*2");
    await page.keyboard.press("Tab");
    const row = table.locator("tr").nth(1);
    const a2 = row.locator("td, th").nth(0);
    const b2 = row.locator("td, th").nth(1);
    await page.waitForFunction((el) => el.classList.contains("ws-num-cell"), await a2.elementHandle(), { timeout: 5000 }).catch(async () => {
      throw new Error(`A2 ("${await a2.innerText()}") isn't right-aligned: class="${await a2.getAttribute("class")}"`);
    });
    const value = b2.locator(".ws-formula-value");
    await value.waitFor({ timeout: 5000 }).catch(async () => {
      throw new Error(`B2 shows no formula value: "${await b2.innerText()}"`);
    });
    assert.equal((await value.innerText()).trim(), "24");
  }));
