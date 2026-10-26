/**
 * Attaching Playwright to the user's debug Chrome (the one `npm run chrono:chrome` starts).
 * Shared by every browser driver (src/plugins/<id>/driver.mjs) and scripts/chrono-mcp.mjs.
 *
 * connectOverCDP attaches to EVERY open tab and waits for each, so a single tab that doesn't
 * answer — a frozen/hung tab or one stuck on a dialog (seen with an idle "New Tab" page) — makes
 * the whole attach time out with an opaque error. So first ping each tab over its own CDP socket;
 * the ones that stay silent (after being woken) are closed and opened anew at their address
 * (replaceTabs), so one stuck tab no longer stops every driver. One that won't even close is LEFT OUT
 * of the attach — a local filter between Playwright and Chrome (cdp-filter.mjs) hides it; without
 * that filter (another Playwright) it fails fast, naming the tab, as it did before.
 * When Chrome isn't running at all, start it (with the page the tool needs) instead.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { NO_BROWSER_MESSAGE, chromeProfileDir, findBrowser } from "./browser-find.mjs";
import { bridgeLaunch, bridgedPort } from "./cdp-endpoint.mjs";
import { startCdpFilter } from "./cdp-filter.mjs";

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};

/**
 * Run `fn` holding the lock for one app's tab ("Chrono", "Outlook"), across processes: each
 * run reloads its tab and pages through weeks, so a second run waits for the first (up to
 * 2.5 min) rather than reloading the tab under it. A lock whose process is gone is stale — one whose
 * process lives only past an hour (a hung driver: the longest run, a WhatsApp history, stops at 45
 * minutes). Per account's Chrome (its debug port): two accounts' Chromes don't wait for each other.
 */
export async function withTabLock(app, tool, fn, debug = () => {}) {
  const port = /:(\d+)/.exec(process.env.CHRONO_CDP_ENDPOINT || "")?.[1] ?? "9222";
  const file = path.join(os.tmpdir(), `zeff-${app.toLowerCase()}-${port}-mcp.lock`);
  const until = Date.now() + 150000;
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, tool, at: Date.now() }), { flag: "wx" });
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(file, "utf8"));
      } catch {}
      if (!holder || !isAlive(holder.pid) || Date.now() - holder.at > 60 * 60000) {
        try {
          unlinkSync(file);
        } catch {}
        continue;
      }
      if (Date.now() > until) {
        throw new Error(`${app} is busy with another run (${holder.tool}, started ${new Date(holder.at).toLocaleTimeString()}) — try again when it's done.`);
      }
      debug(`waiting for ${holder.tool} (pid ${holder.pid}) to finish`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) unlinkSync(file);
    } catch {}
  }
}

/** Ask one tab to evaluate 1+1; resolves false when it doesn't answer within `ms`. */
function pingTab(wsUrl, ms) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      done(false);
      return;
    }
    ws.onerror = () => done(false);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1+1", returnByValue: true } }));
    ws.onmessage = (m) => {
      try {
        if (JSON.parse(String(m.data)).id === 1) done(true);
      } catch { /* not ours */ }
    };
  });
}

/**
 * Tabs that don't answer: each is brought to the front (what un-freezes a tab Chrome put to sleep) and asked
 * again. The ones that still don't answer. Nothing is closed or changed in them. `ping`/`activate` are
 * there for the tests.
 */
export async function wakeTabs(cdp, tabs, { ping = pingTab, activate = (t) => fetch(`${cdp.replace(/\/+$/, "")}/json/activate/${t.id}`, { signal: AbortSignal.timeout(3000) }) } = {}) {
  const still = [];
  for (const t of tabs) {
    try {
      await activate(t);
    } catch {
      // not to be woken: asked anyway
    }
    if (!(await ping(t.webSocketDebuggerUrl, 6000))) still.push(t);
  }
  return still;
}

/**
 * Tabs that stay hung (after being woken): closed — Chrome's browser process does it, the tab's own frozen page
 * can't stop it — and each web page opened anew at its address, so the app is there again for the drivers (a
 * frozen Punch tab held up every sync of this Chrome; hidden instead, a driver opened a second one, a GitLab tab
 * each turn). Pages that aren't web pages (a new tab, chrome://) aren't reopened. The ones it couldn't close.
 * `close`/`open` are there for the tests.
 */
export async function replaceTabs(
  cdp,
  tabs,
  {
    // Closed only once it's gone from the list: a hung renderer can keep it "closing" for a while — and attached to then, it
    // holds the attach up as before (left out then, below).
    close = async (t) => {
      const base = cdp.replace(/\/+$/, "");
      if (!(await fetch(`${base}/json/close/${t.id}`, { signal: AbortSignal.timeout(5000) })).ok) return false;
      for (let i = 0; i < 20; i++) {
        if (!(await listTargets(base)).some((x) => x.id === t.id)) return true;
        await sleep(500);
      }
      return false;
    },
    // (Chrome takes a new tab only by PUT since 111.)
    open = (url) => fetch(`${cdp.replace(/\/+$/, "")}/json/new?${encodeURI(url)}`, { method: "PUT", signal: AbortSignal.timeout(5000) }),
  } = {},
) {
  const left = [];
  for (const t of tabs) {
    const closed = await Promise.resolve()
      .then(() => close(t))
      .catch(() => false);
    if (!closed) {
      left.push(t);
      continue;
    }
    if (/^https?:\/\//.test(t.url ?? "")) await Promise.resolve().then(() => open(t.url)).catch(() => {});
  }
  return left;
}

/** The filter that leaves the hung tabs out of the attach (null: there is none here — the caller fails as before). */
async function hungTabsFiltered(cdp, stuck) {
  try {
    const version = await (await fetch(`${cdp.replace(/\/+$/, "")}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
    return await startCdpFilter(version.webSocketDebuggerUrl, new Set(stuck.map((t) => t.id)));
  } catch {
    return null;
  }
}

/** A problem attaching to the automation Chrome, worded for the user; the MCP tools pass it through as-is. */
export class ChromeConnectError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets(cdp) {
  const res = await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

/**
 * Start the automation browser like `npm run chrono:chrome` (scripts/chrono-chrome.ps1): debug port + its
 * own profile (browser-find.mjs: %LOCALAPPDATA%\Zeff, ~/Library/Application Support/Zeff, ~/.local/share/zeff),
 * detached so it outlives this MCP process, opening `urls`. Chrome, else Edge (on every Windows 10/11),
 * Brave, Chromium — or the browser CHROME_PATH names.
 */
function launchChrome(port, urls) {
  const browser = findBrowser();
  if (!browser) throw new ChromeConnectError(`The automation browser isn't running. ${NO_BROWSER_MESSAGE}`);
  // An account of its own (Zeff's Accounts plugin): its own profile — its own sign-ins.
  const profile = chromeProfileDir();
  mkdirSync(profile, { recursive: true });
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...urls];
  const child = spawn(browser.path, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // not startable: the debug port never comes up, waitForLaunch says so
  child.unref();
}

/** After a launch: wait for the debug port, then (best effort) for each start page to arrive back from SSO. */
async function waitForLaunch(cdp, urls) {
  const hosts = urls.map((u) => new URL(u).host);
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 45000) {
    try {
      const pages = (await listTargets(cdp)).filter((t) => t.type === "page");
      up = true;
      if (hosts.every((h) => pages.some((p) => { try { return new URL(p.url).host === h; } catch { return false; } }))) {
        await sleep(1500); // let the app boot past its first render
        return;
      }
    } catch {
      // port not up yet
    }
    await sleep(500);
  }
  if (!up) throw new ChromeConnectError("Started the automation browser, but its debug port never came up — close its window (an already running Chrome / Edge with this profile can block it) and try again.");
  // Still on a sign-in page: carry on — the tool reports "not signed in" so you can sign in there.
}

/**
 * Attach to the automation Chrome. When it isn't running and `launchUrls` is given (Chrono /
 * Punch), start it first — so the export buttons work without "npm run chrono:chrome".
 */
export async function connectToChrome(cdp, { timeout = 20000, launchUrls = [] } = {}) {
  let targets;
  try {
    targets = await listTargets(cdp).catch(async () => (await sleep(1500), listTargets(cdp)));
  } catch {
    const { hostname, port } = new URL(cdp);
    // In a container the browser is the host's: started by asking the bridge (scripts/chrome-bridge.mjs).
    const bridged = bridgedPort(cdp);
    if (!launchUrls.length || (!bridged && !["127.0.0.1", "localhost"].includes(hostname))) {
      throw new ChromeConnectError(
        `The automation browser isn't running (nothing answers on ${cdp}). Open Menu → Sign-ins in Zeff and use "Sign in" (that starts it), sign in to Chrono/Punch there if asked, and try again.`,
      );
    }
    if (bridged) await bridgeLaunch(bridged, launchUrls).catch((e) => { throw new ChromeConnectError(e.message); });
    else launchChrome(port || "9222", launchUrls);
    await waitForLaunch(cdp, launchUrls);
    targets = await listTargets(cdp);
  }
  const tabs = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const answers = await Promise.all(tabs.map((t) => pingTab(t.webSocketDebuggerUrl, 3000)));
  // A busy machine can hold Chrome up for a few seconds: those asked once more, with more time.
  const slow = tabs.filter((_, i) => !answers[i]);
  const again = slow.length ? (await sleep(1500), await Promise.all(slow.map((t) => pingTab(t.webSocketDebuggerUrl, 8000)))) : [];
  // Chrome freezes tabs that stay in the background for a while (Memory Saver): they answer again once
  // they're brought to the front — so wake them before giving up. (A really hung tab stays stuck.)
  const hung = await wakeTabs(cdp, slow.filter((_, i) => !again[i]));
  // Still hung: closed and opened anew (what was done by hand) — only one that won't close is left out below.
  const stuck = hung.length ? await replaceTabs(cdp, hung) : [];
  if (hung.length > stuck.length) {
    const names = hung.filter((t) => !stuck.includes(t)).map((t) => `“${t.title || t.url}”`).join(", ");
    process.stderr.write(`[chrome-cdp] closed (a web page opened anew) ${hung.length - stuck.length === 1 ? "a tab that wasn't" : "tabs that weren't"} responding: ${names}\n`);
    await sleep(1500); // the new ones under way before the attach
  }
  if (stuck.length) {
    const names = stuck.map((t) => `“${t.title || t.url}” (${t.url.slice(0, 60)})`).join(", ");
    // The rest is attached without them — through the filter that leaves them out.
    const proxy = await hungTabsFiltered(cdp, stuck);
    if (proxy) {
      process.stderr.write(`[chrome-cdp] left out ${stuck.length === 1 ? "a tab that isn't" : "tabs that aren't"} responding: ${names}\n`);
      const browser = await chromium.connectOverCDP(proxy.endpoint, { timeout }).catch((e) => {
        proxy.close();
        throw e;
      });
      const close = browser.close.bind(browser);
      browser.close = async () => {
        try {
          await close();
        } finally {
          proxy.close();
        }
      };
      browser.hungTabs = stuck.map((t) => ({ id: t.id, title: t.title, url: t.url }));
      return browser;
    }
    throw new ChromeConnectError(
      `A tab in the automation Chrome isn't responding: ${names}. Close ${stuck.length === 1 ? "that tab" : "those tabs"} (or dismiss any dialog open there) and try again.`,
    );
  }
  return chromium.connectOverCDP(cdp, { timeout });
}
