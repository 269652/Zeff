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

test("forms: “Make a form from this table” in the ⋯ menu makes a form asking every column and opens it", (t) =>
  withPage(t, async (page) => {
    await open(page, `/workspace/${SEED.dbId}`);
    await page.getByRole("button", { name: rx("More", "Mehr") }).first().click();
    await page.getByRole("menuitem", { name: rx("Make a form from this table", "Formular aus dieser Tabelle machen") }).click();
    await page.waitForURL((u) => /\/workspace\/\d+$/.test(u.pathname) && !u.pathname.endsWith(`/${SEED.dbId}`), { timeout: 60_000 });
    // The designer's canvas: the title and both columns as fields.
    for (const name of ["Dosis", "Genommen"])
      await page.locator("main").getByText(name, { exact: true }).first().waitFor({ timeout: 20_000 }).catch(() => {
        throw new Error(`The form made from the table has no field "${name}".`);
      });
  }));

test("forms: “New with a form …” makes the entry form, and a board column's + New opens it with the column's status", (t) =>
  withPage(t, async (page) => {
    await open(page, `/workspace/${SEED.boardDb}`);
    // No entry form yet: the New menu offers one (a server this ran on before has it: New opens it).
    await page.getByRole("button", { name: rx("New from a template", "Neu aus einer Vorlage") }).first().click();
    const offer = page.getByRole("menuitem", { name: rx("New with a form …", "Neu mit einem Formular …") });
    if (await offer.isVisible({ timeout: 3_000 }).catch(() => false)) await offer.click();
    else {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: rx("New", "Neu"), exact: true }).first().click();
    }
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Fällig").waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error("The entry form opened by “New with a form …” doesn't ask the date column.");
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    // A column's + New: the form, its status set to the column's.
    await page.locator(".ws-column", { hasText: "Erledigt" }).getByRole("button", { name: /^\+ (New|Neu)$/ }).click();
    await dialog.getByLabel("Status").waitFor({ timeout: 20_000 });
    assert.equal(await dialog.getByLabel("Status").inputValue(), "e2eDone", "the status isn't the column's");
    const title = `Aus der Spalte ${Date.now()}`;
    await dialog.getByLabel(/Aufgabe/).fill(title);
    await dialog.getByRole("button", { name: rx("Send", "Senden") }).click();
    await page.locator(".ws-column", { hasText: "Erledigt" }).getByText(title).waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error(`The row "${title}" isn't in the column "Erledigt".`);
    });
  }));

test("forms: a person as a field's default shows by name in the designer, not as #id", (t) =>
  withPage(t, async (page) => {
    await open(page, `/workspace/${SEED.personForm}`);
    await page.locator("main").getByText(SEED.personName).first().waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error(`The person default shows no "${SEED.personName}".`);
    });
    assert.equal(await page.locator("main").getByText(`#${SEED.personId}`, { exact: true }).count(), 0, "the default still shows its id");
  }));
