#!/usr/bin/env node
/**
 * Show a service's page in the automation Chrome so you can sign in there yourself:
 *   node scripts/chrome-open.mjs <url> [<matchRegex>]
 * A tab already on that service (its origin, or one whose address matches <matchRegex> — a
 * sign-in page it was sent to) is brought to the front; else a new tab opens <url>. Chrome is
 * started when it isn't running. Never types anything — signing in is yours.
 * Prints JSON { ok, newTab, url }.
 */
import { connectToChrome } from "./chrome-cdp.mjs";

const CDP = process.env.CHRONO_CDP_ENDPOINT || "http://127.0.0.1:9222";
const [url, match] = process.argv.slice(2);

async function main() {
  if (!/^https?:\/\//.test(url ?? "")) throw new Error("Usage: chrome-open.mjs <url> [<matchRegex>]");
  const origin = new URL(url).origin;
  const re = match ? new RegExp(match, "i") : null;
  const browser = await connectToChrome(CDP, { launchUrls: [url] });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The automation Chrome has no window open.");
    let page = context.pages().find((p) => {
      const u = p.url();
      return u.startsWith(`${origin}/`) || u === origin || (re ? re.test(u) : false);
    });
    const newTab = !page;
    if (!page) {
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }
    await page.bringToFront();
    process.stdout.write(JSON.stringify({ ok: true, newTab, url: page.url() }));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  process.exitCode = 1;
});
