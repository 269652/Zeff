#!/usr/bin/env node
/**
 * images-mcp — a stdio MCP server that downloads pictures for Zeff from sites that need you
 * signed in (GitLab uploads, Jira attachments, …), read-only. It ATTACHES to the automation
 * Chrome (the one Roar/TimO/Outlook use; default http://127.0.0.1:9222, override with
 * IMAGES_CDP_ENDPOINT) and fetches each picture from a tab on the picture's own site — so
 * Chrome itself uses your session there; no password or cookie ever leaves the browser.
 *
 * Tools:
 *   fetch_images {urls} -> JSON { images: [{ url, ok: true, mime, size, data } | { url, ok: false, error }] }
 *                          data is base64. For a site you're not signed in to, a tab with its
 *                          sign-in page is left open for you.
 */
import { connectToChrome, ChromeConnectError } from "./chrome-cdp.mjs";

const CDP = process.env.IMAGES_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_URLS = 30;
const log = (...a) => process.stderr.write(`[images-mcp] ${a.join(" ")}\n`);
/** Step-by-step logging when IMAGES_DEBUG is set. */
const debug = (...a) => process.env.IMAGES_DEBUG && log(...a);

/** A sign-in page: GitLab's, a generic login, or a single sign-on provider's. */
const isSignIn = (u) =>
  /\/users\/sign_in|\/users\/auth\b|\/login\b|\/signin\b|\/sso\b|\/saml\b|\/oauth|login\.microsoftonline\.com|accounts\.google\.com|\.okta\.com/i.test(u);

const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/**
 * Runs IN the site's tab: fetch each picture (same origin, so Chrome sends your session along)
 * and hand it back as base64. Self-contained — Playwright ships it to the page as source.
 */
async function fetchInPage({ urls, max }) {
  const out = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "include" });
      const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !mime.startsWith("image/")) {
        out.push({ url, ok: false, status: res.status, finalUrl: res.url, mime });
        continue;
      }
      const blob = await res.blob();
      if (blob.size > max) {
        out.push({ url, ok: false, tooBig: true });
        continue;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      out.push({ url, ok: true, mime, size: blob.size, data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
    } catch (e) {
      out.push({ url, ok: false, error: String((e && e.message) || e) });
    }
  }
  return out;
}

/** A new tab on `url`, loaded far enough to run scripts in. */
async function openTab(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => debug(`opening ${url}: ${e}`));
  return page;
}

/** One site's pictures, from a tab on that site. */
async function fetchFromSite(context, origin, urls) {
  const host = new URL(origin).host;
  const signIn = `Sign in to ${host} in the automation Chrome (a tab is open there), then fetch the pictures again.`;
  // A tab already on that site, else a new one. One waiting on its sign-in page means: not signed in yet.
  const onSite = context.pages().filter((p) => originOf(p.url()) === origin);
  let page = onSite.find((p) => !isSignIn(p.url()));
  if (!page && onSite.length) return urls.map((url) => ({ url, ok: false, error: signIn }));
  const opened = !page;
  if (!page) page = await openTab(context, `${origin}/`);
  if (originOf(page.url()) !== origin || isSignIn(page.url())) {
    debug(`${host}: not signed in (${page.url()})`);
    return urls.map((url) => ({ url, ok: false, error: signIn })); // the tab stays, for signing in
  }
  const got = await page.evaluate(fetchInPage, { urls, max: MAX_BYTES });
  const out = got.map((r) => {
    if (r.ok) return r;
    if (r.tooBig) return { url: r.url, ok: false, error: `larger than ${MAX_BYTES / 1024 / 1024} MB` };
    if (r.error) return { url: r.url, ok: false, error: r.error };
    if ((r.finalUrl && isSignIn(r.finalUrl)) || r.status === 401) return { url: r.url, ok: false, error: signIn, signInUrl: r.finalUrl };
    if (r.status === 403) return { url: r.url, ok: false, error: `${host} doesn't let you see it (403)` };
    if (r.status === 404) return { url: r.url, ok: false, error: `not found on ${host} (404)` };
    if (r.status >= 400) return { url: r.url, ok: false, error: `${host} answered ${r.status}` };
    return { url: r.url, ok: false, error: `isn't a picture (${r.mime || "no type"})` };
  });
  const signInUrl = out.find((r) => r.signInUrl)?.signInUrl;
  if (signInUrl && opened) {
    // Signed out: leave the tab on the sign-in page.
    await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  } else if (opened) {
    await page.close().catch(() => {});
  }
  for (const r of out) delete r.signInUrl;
  return out;
}

/** Each picture's data (base64), fetched site by site through the automation Chrome. Returns JSON { images }. */
async function fetchImages({ urls }) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).map(String))].filter((u) => /^https?:\/\//i.test(u) && originOf(u)).slice(0, MAX_URLS);
  if (!list.length) throw new Error("urls (http/https addresses of pictures) are required.");
  const bySite = new Map();
  for (const u of list) bySite.set(originOf(u), [...(bySite.get(originOf(u)) ?? []), u]);
  const browser = await connectToChrome(CDP, { launchUrls: [...bySite.keys()].map((o) => `${o}/`) });
  const images = [];
  try {
    const context = browser.contexts()[0];
    if (!context) throw new ChromeConnectError("The automation Chrome has no window open — open one there and try again.");
    for (const [origin, group] of bySite) {
      try {
        images.push(...(await fetchFromSite(context, origin, group)));
      } catch (e) {
        const why = String(e?.message || e).split("\n")[0].slice(0, 200);
        images.push(...group.map((url) => ({ url, ok: false, error: why })));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return JSON.stringify({ images });
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "fetch_images",
    description:
      "Download pictures (e.g. GitLab uploads) through the automation Chrome, using the sessions signed in there — read-only. Returns JSON { images: [{ url, ok, mime, size, data (base64) } | { url, ok: false, error }] }.",
    inputSchema: {
      type: "object",
      properties: { urls: { type: "array", items: { type: "string" }, description: "http(s) addresses of the pictures (at most 30)." } },
      required: ["urls"],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "images", version: "0.1.0" } });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "fetch_images") return ok(id, textResult(await fetchImages(args)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => log("handler error:", String(e)));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready (CDP ${CDP})`);
