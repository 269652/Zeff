/**
 * The e2e smoke suite's helpers (node:test + playwright-core, headless Chrome): the server and its seed from the environment
 * (e2e/run.mjs sets them), one browser per test file, a fresh page per test with a screenshot on failure, and the app's
 * common moves — a new workspace page, its editor, "saved". The UI may be German or English: match both.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before } from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

export const BASE = (process.env.ZEFF_E2E_URL ?? "").replace(/\/+$/, "");
if (!BASE) throw new Error("ZEFF_E2E_URL is not set — run the suite with `npm run e2e`.");
export const SEED = JSON.parse(fs.readFileSync(process.env.ZEFF_E2E_SEED ?? "", "utf8"));
const CHROME = process.env.CHROME_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
const ARTIFACTS = path.join(import.meta.dirname, "artifacts");

/** The test server's data folder (beside the seed file): its database, the fake AI's files. */
const DATA_DIR = path.dirname(process.env.ZEFF_E2E_SEED ?? "");

/**
 * The fake Claude's next answer (a test server started with --fake-ai: tests/fake-claude-json.mjs reads it at each call) — written
 * before the click that asks the AI.
 */
export function fakeAnswer(output) {
  if (!process.env.ZEFF_E2E_FAKE_AI) throw new Error("This test needs a test server started with --fake-ai (npm run e2e starts one; with --url, start it with npm run test:server -- --fake-ai).");
  fs.writeFileSync(process.env.ZEFF_E2E_FAKE_AI, JSON.stringify(output)); // (the file the test server's fake CLI reads)
}

/** A read-only query of the test server's database (what the UI saved, checked where it is kept). */
export function dbAll(sql, ...params) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(DATA_DIR, "zeff.db"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

/** A regex for a text in either language: rx("Saved", "Gespeichert"). */
export const rx = (...words) => new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(async () => {
  await browser?.close();
});

/**
 * A test with a fresh browser page: on failure a screenshot (e2e/artifacts/<name>.png) and the page's errors go with the
 * message. Use as: test("…", (t) => withPage(t, async (page) => { … })).
 */
export async function withPage(t, fn) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "de-DE" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror at ${page.url()}: ${String(e).slice(0, 300)}`));
  try {
    await fn(page);
  } catch (e) {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const shot = path.join(ARTIFACTS, `${t.name.replace(/[^\w-]+/g, "_").slice(0, 80)}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    const err = e instanceof Error ? e : new Error(String(e));
    err.message = `${err.message}\n  at ${page.url()}\n  screenshot: ${shot}${errors.length ? `\n  ${errors.join("\n  ")}` : ""}`;
    throw err;
  } finally {
    await context.close();
  }
}

/** A page of the app opened and hydrated (React has taken over the buttons — before that a click does nothing). */
export async function open(page, route) {
  await page.goto(BASE + route, { waitUntil: "load" });
  await page.waitForFunction(() => [...document.querySelectorAll("main button, main [contenteditable]")].some((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), null, { timeout: 120_000 });
  // (A moment to settle: a hydration mismatch makes React render the tree again on the client right after.)
  await page.waitForTimeout(500);
}

/** A new, empty workspace page (Workspace → New page); its id. */
export async function newPage(page) {
  await open(page, "/workspace");
  await page.getByRole("button", { name: rx("New page", "Neue Seite") }).click();
  await page.waitForURL(/\/workspace\/\d+$/, { timeout: 30_000 }).catch(() => {
    throw new Error(`"New page" didn't open the new page within 30 s (still on /workspace — the page may have been made: see Recent).`);
  });
  await editor(page).waitFor();
  return Number(/\/workspace\/(\d+)$/.exec(page.url())[1]);
}

/** The page's block editor. */
export const editor = (page) => page.locator("main .ProseMirror").first();

/** Into the editor, at the end of its text. */
export async function focusEditorEnd(page) {
  await editor(page).click();
  await page.keyboard.press("Control+End");
}

/** What was typed or changed is saved: after the editor's (or designer's) short pause, no status says "Saving …" any more. */
export async function waitSaved(page) {
  await page.waitForTimeout(1200);
  await page
    .waitForFunction(() => {
      const all = [...document.querySelectorAll("main [role=status]")].map((el) => el.textContent ?? "");
      return !all.some((s) => /Saving|Speichert|Not saved|Nicht gespeichert/i.test(s)) && all.some((s) => /Saved|Gespeichert/i.test(s));
    }, null, { timeout: 20_000 })
    .catch(async () => {
      throw new Error(`Not saved: the status says "${(await page.locator("main [role=status]").allInnerTexts()).join(" | ")}".`);
    });
}

/**
 * What the fake AI answers next (the test server is started with --fake-ai: scripts/test-server.mjs — e2e/run.mjs does): the
 * JSON every AI call gets as its structured output until the next fakeAi. Without a fake AI the test is skipped (`t.skip`).
 */
export const FAKE_AI = process.env.ZEFF_E2E_FAKE_AI ?? "";
export function fakeAi(output) {
  if (!FAKE_AI) throw new Error("This test server has no fake AI (start it with npm run test:server -- --fake-ai).");
  fs.writeFileSync(FAKE_AI, JSON.stringify(output));
}
