import assert from "node:assert/strict";
import test from "node:test";
import { SEED, open, rx, waitSaved, withPage } from "./helpers.mjs";

test("forms: a form with the database's rows ticks a row's checkbox in place, and the database has it", (t) =>
  withPage(t, async (page) => {
    const [row] = SEED.rowTitles;
    await open(page, "/workspace");
    // New → Form (the sidebar's +).
    await page.getByRole("button", { name: rx("New", "Neu") }).filter({ hasText: "+" }).first().click();
    await page.getByRole("menuitem", { name: rx("Form", "Formular") }).click();
    await page.waitForURL(/\/workspace\/\d+$/, { timeout: 60_000 });
    const formUrl = page.url();

    await page.getByLabel(rx("Database it fills", "Datenbank, die es füllt")).selectOption({ label: SEED.dbTitle });
    const addRows = page.getByRole("button", { name: rx("Add Rows of the database to the form", "Zeilen der Datenbank zum Formular hinzufügen") });
    await addRows.waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error('No "Rows of the database" in the palette after choosing the database.');
    });
    await addRows.click();
    await waitSaved(page);

    await page.getByRole("button", { name: rx("Fill in", "Ausfüllen") }).click();
    const box = page.getByRole("checkbox", { name: new RegExp(`(Genommen) – ${row}$`) });
    await box.waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error(`The filled-in form shows no checkbox "Genommen – ${row}".`);
    });
    // Ticked (or, on a server this ran on before, unticked): the other way round from what it is.
    const want = !(await box.isChecked());
    await box.setChecked(want);
    await page.getByRole("button", { name: rx("Send", "Senden") }).click();
    await page.getByText(rx("1 entry updated.", "1 Eintrag aktualisiert.")).first().waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error('No "1 entry updated." after sending the form.');
    });

    // The database's own table has the row ticked.
    await open(page, `/workspace/${SEED.dbId}`);
    const cell = page.locator("main tr", { hasText: row }).getByRole("checkbox", { name: "Genommen", exact: true });
    await cell.waitFor({ timeout: 20_000 });
    assert.equal(await cell.isChecked(), want, `the row "${row}" isn't ${want ? "ticked" : "unticked"} in the database (form: ${formUrl})`);
  }));
