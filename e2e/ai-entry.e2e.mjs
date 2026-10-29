import assert from "node:assert/strict";
import test from "node:test";
import { FAKE_AI, editor, fakeAi, focusEditorEnd, newPage, rx, withPage } from "./helpers.mjs";

// The page's one ✨ entry: the top bar's ✨ (or Ctrl+Shift+Space, or a block's ✨) opens one composer — Think along, Write, Ask
// about this page. The AI is the fake one (the test server's --fake-ai): each test says what it answers.
const skip = FAKE_AI ? false : "the test server has no fake AI (--fake-ai)";

const composer = (page) => page.getByRole("dialog", { name: /Zeff/ });
const openFromBar = async (page) => {
  await page.getByRole("button", { name: rx("Zeff on this page", "Zeff auf dieser Seite") }).click();
  await composer(page).waitFor();
};

test("the top bar's ✨ opens the composer: a field, the three chips; Escape closes it — no separate Write with AI button above the page", { skip }, (t) =>
  withPage(t, async (page) => {
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Reise nach Hamburg");
    await openFromBar(page);
    const box = composer(page);
    await box.getByRole("textbox", { name: rx("What should Zeff do?", "Was soll Zeff tun?") }).waitFor();
    for (const name of [rx("Think along", "Mitdenken"), rx("Write …", "Schreiben …"), rx("Ask about this page", "Zu dieser Seite fragen")]) await box.getByRole("button", { name }).waitFor();
    assert.ok(await box.getByRole("textbox").evaluate((el) => el === document.activeElement), "the field has the focus");
    await page.keyboard.press("Escape");
    await box.waitFor({ state: "detached" });
    assert.equal(await page.locator("main").getByRole("button", { name: rx("Think along", "Mitdenken"), exact: true }).count(), 0, "no second Think along button");
  }));

test("Write: the chip with a mode (continue) proposes the AI's text, Insert here puts it into the page", { skip }, (t) =>
  withPage(t, async (page) => {
    fakeAi({ text: "Wir fahren am Freitag mit dem Zug." });
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Reise nach Hamburg. ");
    await openFromBar(page);
    const box = composer(page);
    await box.getByRole("button", { name: rx("Write …", "Schreiben …") }).click();
    await box.getByRole("combobox", { name: rx("What to write", "Was geschrieben wird") }).selectOption("continue");
    await box.getByRole("button", { name: /^✨ (Write|Schreiben)$/ }).click();
    await box.waitFor({ state: "detached" });
    await page.getByText(rx("AI suggestion", "KI-Vorschlag")).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: rx("Insert here", "Hier einfügen") }).click();
    await editor(page).getByText("Wir fahren am Freitag mit dem Zug.").waitFor();
  }));

test("Think along: the chip (keyboard: Ctrl+Shift+Space) puts a card under the block — its proposal applied goes into the page", { skip }, (t) =>
  withPage(t, async (page) => {
    fakeAi({ intent: "Packen", summary: "Packliste für Hamburg", questions: [], actions: [{ kind: "text", label: "Packliste", markdown: "Schal einpacken" }] });
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Reise nach Hamburg");
    await page.keyboard.press("Control+Shift+Space");
    const box = composer(page);
    await box.waitFor();
    await box.getByRole("textbox").fill("Was muss ich einpacken?");
    await box.getByRole("button", { name: rx("Think along", "Mitdenken") }).click();
    await box.waitFor({ state: "detached" });
    const card = editor(page).locator("[data-assist-card]").first();
    await card.getByText("Packliste für Hamburg").waitFor({ timeout: 60_000 });
    await card.getByRole("checkbox", { name: /Packliste/ }).waitFor();
    await card.getByRole("button", { name: rx("Apply", "Übernehmen") }).click();
    // (Its preview in the card is a <pre>: the paragraph is what went into the page.)
    await editor(page).locator("p", { hasText: "Schal einpacken" }).first().waitFor({ timeout: 30_000 });
  }));

test("Ask about this page: typed text alone is a question — the answer shows in the composer", { skip }, (t) =>
  withPage(t, async (page) => {
    fakeAi({ calls: [], reply: "Zwei Dinge sind offen: Zug und Hotel." });
    await newPage(page);
    await focusEditorEnd(page);
    await page.keyboard.type("Zug buchen, Hotel suchen");
    await openFromBar(page);
    const box = composer(page);
    await box.getByRole("textbox").fill("Was ist offen?");
    await page.keyboard.press("Enter");
    await box.locator("[data-ai-answer]").getByText("Zwei Dinge sind offen: Zug und Hotel.").waitFor({ timeout: 60_000 });
    await box.getByRole("button", { name: rx("Continue in the chat", "Im Chat weiter") }).waitFor();
  }));
