/**
 * Writing to Google Keep the way you would: in keep.google.com (the automation Chrome), Keep's own
 * note editor — typing, its menus and buttons — never its sync interface directly. Each change is
 * what a person could do by hand; what Keep then saves is read back from what its app sends
 * (notes/v1/changes) and returned, so Zeff shows what Keep really has.
 *
 *   createNote(page, { title, text, list, color, labels, pinned, archived })
 *   updateNote(page, { id, kind, title?, text?, list?, color?, labels?, pinned?, archived? })
 *   trashNote(page, { id, kind })
 *
 * A checklist comes as Zeff writes it: "- [ ] …" / "- [x] …" lines in `text` (with `list: true`).
 */
import { COLOR_UI, textToItems } from "./model.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tracing (KEEP_DEBUG): each step on stderr; with KEEP_SHOTS=<folder> also a picture of the open
 * note's editor box after it (only that box — not the notes around it).
 */
let shot = 0;
async function step(page, what) {
  if (!process.env.KEEP_DEBUG) return;
  process.stderr.write(`[keep-write] ${what}\n`);
  if (!process.env.KEEP_SHOTS) return;
  const box = page.locator("[data-zeff-editor]");
  if (await box.count().catch(() => 0)) await box.screenshot({ path: `${process.env.KEEP_SHOTS}/${String(++shot).padStart(2, "0")}-${what.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
}
const re = (words) => new RegExp(`^(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");

/** The open note's editor, tagged so it can be found again (its title field, inside the box with "Schließen"). */
async function editorBox(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate(() => {
      document.querySelectorAll("[data-zeff-editor]").forEach((e) => e.removeAttribute("data-zeff-editor"));
      // The title field: the editor's role=textbox (labelled "Titel" only while it's empty).
      const titles = [...document.querySelectorAll("[contenteditable=true][role=textbox]")].filter((e) => e.offsetParent);
      for (const t of titles.reverse()) {
        let box = t;
        while (box && ![...box.querySelectorAll("[role=button]")].some((b) => /^(schließen|close)$/i.test((b.textContent || "").trim()))) box = box.parentElement;
        if (box) {
          box.setAttribute("data-zeff-editor", "1");
          return true;
        }
      }
      return false;
    });
    if (ok) return page.locator("[data-zeff-editor]");
    await sleep(400);
  }
  throw new Error("Keeps Notiz-Editor ging nicht auf.");
}

/** Keep re-renders the editor now and then (a list turned into text, …): then it's tagged anew. */
async function fresh(page, box) {
  if (!(await box.isVisible().catch(() => false))) await editorBox(page, 8000);
  return box;
}

/** Keep's "Markierte Einträge löschen" question, if it came up: answered "Behalten" — nothing deleted. */
async function keepItems(page) {
  const keep = page.getByRole("button", { name: re(["Behalten", "Keep"]) }).filter({ visible: true }).first();
  if (!(await keep.isVisible().catch(() => false))) return false;
  await keep.click();
  await sleep(400);
  return true;
}

/** Replace a field's content: its own content selected, then the text typed (lines with Enter). */
async function setField(page, field, text) {
  // A menu's leftover layer can sit over it for a moment: then the field gets the focus directly.
  await field.click({ timeout: 5000 }).catch(() => field.evaluate((e) => e.focus()));
  // Not Ctrl+A: in an open list Keep takes that as "all items" (and Backspace as deleting them).
  await field.evaluate((e) => {
    e.focus();
    const range = document.createRange();
    range.selectNodeContents(e);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press("Backspace");
  await sleep(300);
  if (await keepItems(page)) throw new Error("Keep wollte Listeneinträge löschen — abgebrochen, nichts gelöscht.");
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
}

/** The note's text field: the editor's editable field that isn't its title. */
const bodyOf = (box) => box.locator('[contenteditable]:not([contenteditable=false])').filter({ visible: true }).last();

/** What the editor shows now: the title, and the text — a checklist as "- [ ]" / "- [x]" lines. */
async function observe(page, box) {
  const title = ((await box.locator("[contenteditable=true][role=textbox]").first().textContent().catch(() => "")) || "").trim();
  const rows = await readRows(page, box);
  if (rows.length) return { title, list: true, text: rows.filter((r) => r.text).map((r) => `- [${r.checked ? "x" : " "}] ${r.text}`).join("\n") };
  const body = ((await bodyOf(box).innerText().catch(() => "")) || "").replace(/\r/g, "").trim();
  return { title, list: false, text: body };
}

/** A menu entry of the editor's "Mehr" (⋮) menu, clicked. */
async function moreMenu(page, box, words) {
  await fresh(page, box);
  await box.getByRole("button", { name: re(["Mehr", "More"]) }).first().click();
  await sleep(600);
  const item = page.getByRole("menuitem", { name: re(words) }).first();
  if (!(await item.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click();
  await sleep(800);
  return true;
}

/** The checklist rows of the open editor: text and tick (the ticked ones shown, if they were folded away). */
async function readRows(page, box) {
  const folded = box.getByRole("button", { name: /abgeschlossene Einträge|completed items|checked items/i }).first();
  if (await folded.isVisible().catch(() => false)) {
    const expanded = await folded.getAttribute("aria-expanded").catch(() => null);
    if (expanded !== "true") {
      await folded.click().catch(() => {});
      await sleep(500);
    }
  }
  return box.evaluate((el) => {
    // Checkbox and item field sit in different branches of Keep's markup: paired by their height on screen.
    const mid = (e) => {
      const r = e.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    // The text right of each checkbox, at its height: the item (an editable field in an open note, plain
    // text in the composer — whatever holds it). Leaf elements with text, nearest first.
    const texts = [...el.querySelectorAll("*")]
      .filter((e) => e.offsetParent && !e.querySelector("*") && (e.textContent || "").trim())
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2, text: (e.textContent || "").trim() };
      });
    return [...el.querySelectorAll("[role=checkbox]")]
      .filter((cb) => cb.offsetParent)
      .map((cb) => {
        const y = mid(cb);
        const x = cb.getBoundingClientRect().right;
        const near = texts.filter((t) => t.x >= x && Math.abs(t.y - y) < 14).sort((a, b) => a.x - b.x)[0];
        return { text: near?.text ?? "", checked: cb.getAttribute("aria-checked") === "true" };
      });
  });
}

/** A real mouse click in the middle of an element (Keep's checkboxes want one). */
async function clickMiddle(page, locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Tick / untick rows by their text until they match `items`. */
async function setTicks(page, box, items) {
  for (const want of items) {
    for (let tries = 0; tries < 3; tries++) {
      const rows = await readRows(page, box);
      const i = rows.findIndex((r) => r.text === want.text && r.checked !== want.checked);
      if (i < 0) break;
      await clickMiddle(page, box.locator("[role=checkbox]").filter({ visible: true }).nth(i));
      await sleep(350);
    }
  }
}

/** The body as a checklist with exactly these items: typed as lines, turned into a list, ticked. */
async function setList(page, box, items) {
  const rows = await readRows(page, box);
  const sameTexts = rows.length === items.length && rows.every((r, i) => r.text === items[i].text);
  if (rows.length && sameTexts) return setTicks(page, box, items);
  // Rewritten: as text (Kästchen ausblenden), the lines set, back to a list (Kästchen einblenden).
  if (rows.length) {
    await moreMenu(page, box, ["Kästchen ausblenden", "Hide checkboxes"]);
    // With ticked items Keep asks whether to delete them: kept (as lines — they're ticked again below).
    await keepItems(page);
  }
  await step(page, "as text");
  await setField(page, bodyOf(await fresh(page, box)), items.map((i) => i.text).join("\n"));
  await step(page, "lines typed");
  await moreMenu(page, box, ["Kästchen einblenden", "Show checkboxes"]);
  await sleep(600);
  await step(page, "as list");
  await setTicks(page, await fresh(page, box), items);
}

async function setColor(page, box, color) {
  const words = COLOR_UI[color || "default"] ?? COLOR_UI.default;
  await box.getByRole("button", { name: re(["Hintergrundoptionen", "Background options"]) }).first().click();
  await sleep(600);
  const opt = page.getByRole("option", { name: re(words) }).first();
  if (await opt.isVisible().catch(() => false)) await opt.click();
  await sleep(400);
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);
}

/**
 * Exactly these labels on the note: Mehr → Label hinzufügen, each ticked or unticked (a new one made).
 * Which ones it has is read from the picker itself — not from what Zeff last knew.
 */
async function setLabels(page, box, wanted) {
  const want = new Set(wanted.map((l) => l.trim()).filter(Boolean));
  if (!(await moreMenu(page, box, ["Label hinzufügen", "Labels ändern", "Add label", "Change labels"]))) throw new Error("Keep bietet „Label hinzufügen“ nicht an.");
  // The picker (a role=menu): "Namen des Labels eingeben", under it a role=menuitemcheckbox per label —
  // its aria-label the name, aria-checked whether the note has it. Typing filters the rows, and while
  // no label has exactly that name Keep offers a button 'Label "…" erstellen'.
  const input = page.locator('input[aria-label="Namen des Labels eingeben"], input[aria-label*="label name" i]').filter({ visible: true }).first();
  await input.waitFor({ timeout: 10000 });
  const menu = page.locator("[role=menu]").filter({ has: input });
  const quoted = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // All labels (nothing typed): the ones to tick and the ones to untick.
  await input.fill("");
  await sleep(500);
  const all = await menu.locator("[role=menuitemcheckbox]").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("aria-label") || "", on: e.getAttribute("aria-checked") === "true" })));
  const changes = [...want].filter((n) => !all.some((r) => r.name === n && r.on)).concat(all.filter((r) => r.on && !want.has(r.name)).map((r) => r.name));
  for (const name of changes) {
    await input.fill(name);
    await sleep(600);
    const rows = menu.locator("[role=menuitemcheckbox]").filter({ visible: true });
    const i = (await rows.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || ""))).indexOf(name);
    await step(page, `label ${want.has(name) ? "on" : "off"}: row ${i}`);
    if (i >= 0) {
      const row = rows.nth(i);
      if (((await row.getAttribute("aria-checked")) === "true") !== want.has(name)) await row.click();
    } else if (want.has(name)) {
      const create = menu.getByRole("button", { name: new RegExp(`^(Label [„"]${quoted(name)}["“] erstellen|Create (label )?["“]${quoted(name)}["”])$`, "i") }).first();
      if (!(await create.isVisible().catch(() => false))) throw new Error(`Keep bietet das Label „${name}“ nicht an.`);
      await create.click();
    }
    await sleep(500);
  }
  await page.keyboard.press("Escape");
  await sleep(600);
}

async function setPinned(box, pinned) {
  const btn = box.getByRole("button", { name: pinned ? re(["Anpinnen", "Pin note"]) : re(["Loslösen", "Unpin note"]) }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click();
  await sleep(300);
}

/** Close the editor — by archiving it (or taking it out of the archive), else with "Schließen". */
async function finish(page, box, archived) {
  if (archived === true) {
    const a = box.getByRole("button", { name: re(["Archivieren", "Archive"]) }).first();
    if (await a.isVisible().catch(() => false)) return a.click();
  }
  if (archived === false) {
    const u = box.getByRole("button", { name: re(["Archivierung aufheben", "Unarchive"]) }).first();
    if (await u.isVisible().catch(() => false)) await u.click();
    await sleep(500);
  }
  await box.getByRole("button", { name: re(["Schließen", "Close"]) }).first().click();
}

/** Back to the notes (no note open). */
async function toGrid(page) {
  await page.evaluate(() => (location.hash = "")).catch(() => {});
  await sleep(800);
}

export async function createNote(page, v) {
  await toGrid(page);
  // The composer's text field (the only editable one while no note is open).
  const field = page.locator("[contenteditable=true][role=combobox]").filter({ visible: true }).first();
  await field.click({ timeout: 15000 });
  await sleep(600);
  const box = await editorBox(page);
  await step(page, "composer open");
  const items = v.list ? textToItems(v.text) : [];
  if (v.list) {
    await setField(page, bodyOf(box), items.map((i) => i.text).join("\n"));
  } else await setField(page, bodyOf(box), v.text ?? "");
  await step(page, "body typed");
  if (v.title) await setField(page, box.locator("[contenteditable=true][role=textbox]").first(), v.title);
  await step(page, "title typed");
  if (v.list) {
    const shown = await moreMenu(page, box, ["Kästchen einblenden", "Show checkboxes"]);
    await step(page, `checkboxes shown ${shown}`);
    await sleep(600);
    await setTicks(page, box, items);
    await step(page, "ticked");
  }
  if (v.color) await setColor(page, box, v.color);
  await step(page, "colour set");
  if (v.labels?.length) await setLabels(page, box, v.labels);
  await step(page, "labels set");
  if (v.pinned) await setPinned(box, true);
  await step(page, "pinned");
  const seen = await observe(page, box);
  await finish(page, box, v.archived ? true : undefined);
  await step(page, "closed");
  return seen;
}

/** A text's lines without the checklist marks — to recognise a note by its content. */
const linesOf = (text) =>
  String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*- \[[ xX]\]\s?/, "").trim())
    .filter(Boolean);

/**
 * The note `v.id` open in Keep's editor — and made sure it IS that note before anything is changed:
 * the address names it, and the editor shows its title (or, without one, its first line). Never the
 * empty composer, never another note.
 */
async function openNote(page, v, current) {
  await page.evaluate((h) => (location.hash = h), `#${v.kind === "list" ? "LIST" : "NOTE"}/${v.id}`);
  const box = await editorBox(page);
  const title = (current.title || "").trim();
  const first = linesOf(current.text)[0];
  for (let i = 0; i < 12; i++) {
    const hash = await page.evaluate(() => location.hash);
    const seen = await observe(page, box);
    const content = title ? seen.title === title : first ? linesOf(seen.text).includes(first) : /\b(Bearbeitet|Edited)\b/.test(await box.innerText().catch(() => ""));
    if (hash.includes(v.id) && content) return box;
    await sleep(500);
  }
  await page.keyboard.press("Escape").catch(() => {});
  throw new Error("Keep hat nicht diese Notiz geöffnet — nichts geändert.");
}

export async function updateNote(page, v, current) {
  const box = await openNote(page, v, current);
  await step(page, "opened");
  if (v.title !== undefined && v.title !== current.title) await setField(page, box.locator("[contenteditable=true][role=textbox]").first(), v.title);
  await step(page, "title set");
  if (v.text !== undefined) {
    if (v.list) await setList(page, box, textToItems(v.text));
    else if (v.text !== current.text) {
      // A list that should become text: its checkboxes away first.
      if (current.kind === "list") {
        await moreMenu(page, box, ["Kästchen ausblenden", "Hide checkboxes"]);
        await keepItems(page);
      }
      await setField(page, bodyOf(box), v.text);
    }
  }
  if (v.color !== undefined && (v.color || null) !== (current.color || null)) await setColor(page, box, v.color);
  if (v.labels !== undefined) await setLabels(page, box, v.labels);
  if (v.pinned !== undefined && v.pinned !== current.pinned) await setPinned(box, v.pinned);
  const seen = await observe(page, box);
  await finish(page, box, v.archived !== undefined && v.archived !== current.archived ? v.archived : undefined);
  return seen;
}

export async function trashNote(page, v, current) {
  const box = await openNote(page, v, current);
  if (!(await moreMenu(page, box, ["Notiz löschen", "Delete note"]))) throw new Error("Keep bietet „Notiz löschen“ nicht an.");
}
