import type { Browser, BrowserContext, Page } from "playwright-core";
import { publicUrl } from "@/plugins/web-search/search";

/**
 * An automated Chrome for the AI: it opens a public page, does a few steps on it (click, type) and reads what is there — the text,
 * the links, the pictures. Each call is a browser of its own with an empty profile, closed afterwards: no logins, no cookies, nothing
 * of this computer. It browses for its user with Chrome's normal User-Agent; beyond that it hides nothing, so a site can still refuse
 * it (say so; don't get round it). The machine's own and private addresses stay out of reach, also for what a page loads or redirects
 * to. Server only.
 */

export type BrowserStep = { action: "click" | "fill" | "press" | "wait" | "scroll"; target?: string; text?: string };
export type BrowserImage = { src: string; alt: string; width: number; height: number };
export type BrowserPage = { url: string; status: number | null; title: string; text: string; truncated: boolean; mainImage: string; images: BrowserImage[]; links: { href: string; text: string }[] };

type Deps = { /** The check of each address (tests give their own: theirs are local). */ check?: (url: string) => Promise<unknown>; launch?: () => Promise<Browser> };

const TIMEOUT = 60_000;
const STEP_TIMEOUT = 8_000;
export const MAX_STEPS = 10;

async function launchChrome(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  let last: unknown;
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`No browser to start — Chrome or Edge has to be installed on this computer. (${last instanceof Error ? last.message.split("\n")[0] : String(last)})`);
}

/** The User-Agent of this Chrome without the word Headless: it browses for its user, as the Chrome it is — real version, real system. */
async function userAgent(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  const ua = (await page.evaluate("navigator.userAgent")) as string;
  await page.close();
  return ua.replace("HeadlessChrome", "Chrome");
}

/** Every address the page reaches goes through the same check as the page itself: asked once per host. */
async function guard(context: BrowserContext, check: (url: string) => Promise<unknown>): Promise<void> {
  const hosts = new Map<string, Promise<boolean>>();
  await context.route("**/*", async (route) => {
    const raw = route.request().url();
    if (!/^https?:/i.test(raw)) return route.continue();
    const host = new URL(raw).host;
    if (!hosts.has(host)) hosts.set(host, check(raw).then(() => true, () => false));
    return (await hosts.get(host)) ? route.continue() : route.abort("blockedbyclient");
  });
  // (Sockets go past the routes above: a page read here needs none.)
  await context.routeWebSocket(/.*/, (ws) => ws.close());
}

/** What a step's target means: a CSS or XPath selector, else the words on the thing. */
const locate = (page: Page, target: string) => (/^(css=|xpath=|[.#[]|[a-z][a-z0-9-]*[.#[:>\s])/i.test(target) || /^[a-z][a-z0-9-]*$/.test(target) ? page.locator(target) : page.getByText(target)).first();

async function doStep(page: Page, s: BrowserStep): Promise<void> {
  const need = (v: string | undefined, what: string) => {
    if (!v) throw new Error(`The step “${s.action}” needs ${what}.`);
    return v;
  };
  if (s.action === "click") await locate(page, need(s.target, "a target")).click({ timeout: STEP_TIMEOUT });
  else if (s.action === "fill") await locate(page, need(s.target, "a target")).fill(s.text ?? "", { timeout: STEP_TIMEOUT });
  else if (s.action === "press") await page.keyboard.press(need(s.text ?? s.target, "a key"));
  else if (s.action === "scroll") await page.mouse.wheel(0, 2000);
  else await (s.target ? locate(page, s.target).waitFor({ timeout: STEP_TIMEOUT }) : page.waitForTimeout(1500));
  await page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT }).catch(() => undefined);
}

/** Read in the page. As a string: compiled code would bring helpers along that the page doesn't have. */
const READ = `(() => {
  const meta = (p) => document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]')?.content ?? "";
  const images = [...document.images]
    .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "", width: i.naturalWidth, height: i.naturalHeight }))
    .filter((i) => /^https?:/.test(i.src) && i.width >= 64 && i.height >= 64)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const links = [...document.links].map((a) => ({ href: a.href, text: (a.innerText || "").replace(/\\s+/g, " ").trim() })).filter((l) => /^https?:/.test(l.href) && l.text);
  return { title: document.title, text: document.body?.innerText ?? "", mainImage: meta("og:image") || meta("twitter:image"), images: images.slice(0, 20), links: links.slice(0, 60) };
})()`;

// One at a time: a Chrome is heavy, and the chat's calls come one after the other anyway.
const g = globalThis as { __zeffBrowserTurn?: Promise<unknown> };

export async function browserOpen(raw: string, opts: { steps?: BrowserStep[]; maxChars?: number } = {}, deps: Deps = {}): Promise<BrowserPage> {
  const check = deps.check ?? publicUrl;
  await check(raw);
  const steps = (opts.steps ?? []).slice(0, MAX_STEPS);
  const turn = (g.__zeffBrowserTurn ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const browser = await (deps.launch ?? launchChrome)();
    const limit = setTimeout(() => void browser.close().catch(() => undefined), TIMEOUT);
    try {
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", userAgent: await userAgent(browser) });
      await guard(context, check);
      const page = await context.newPage();
      const res = await page.goto(raw, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
      for (const s of steps) await doStep(page, s);
      if (steps.length) await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
      const got = (await page.evaluate(READ)) as Pick<BrowserPage, "title" | "text" | "mainImage" | "images" | "links">;
      const max = Math.min(opts.maxChars ?? 12000, 40000);
      return { ...got, url: page.url(), status: res?.status() ?? null, text: got.text.slice(0, max), truncated: got.text.length > max };
    } catch (e) {
      throw new Error(browser.isConnected() ? (e instanceof Error ? e.message.split("\n")[0] : String(e)) : `The page took too long (over ${TIMEOUT / 1000} s).`);
    } finally {
      clearTimeout(limit);
      await browser.close().catch(() => undefined);
    }
  });
  g.__zeffBrowserTurn = turn;
  return turn;
}
