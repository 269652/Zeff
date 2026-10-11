/**
 * Attaching Playwright to the user's debug Chrome (the one `npm run chrono:chrome` starts).
 * Shared by every browser driver (src/plugins/<id>/driver.mjs) and scripts/chrono-mcp.mjs.
 *
 * connectOverCDP attaches to EVERY open tab, so a single tab that doesn't answer — a
 * frozen/hung tab or one stuck on a dialog (seen with an idle "New Tab" page) — makes the
 * whole attach time out with an opaque error. So first ping each tab over its own CDP
 * socket and, if one doesn't answer, fail fast naming it. Nothing is closed or changed.
 * When Chrome isn't running at all, start it (with the page the tool needs) instead.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

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

/** A problem attaching to the automation Chrome, worded for the user; the MCP tools pass it through as-is. */
export class ChromeConnectError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets(cdp) {
  const res = await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

/**
 * Start the automation Chrome exactly like `npm run chrono:chrome` (scripts/chrono-chrome.ps1):
 * debug port + its own profile under %LOCALAPPDATA%\Zeff\chrono-chrome-profile, detached so
 * it outlives this MCP process, opening `urls`.
 */
function launchChrome(port, urls) {
  const chrome = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].find((p) => existsSync(p));
  if (!chrome) throw new ChromeConnectError('The automation Chrome isn\'t running and Chrome wasn\'t found to start it — run "npm run chrono:chrome".');
  // An account of its own (Zeff's Accounts plugin): its own profile — its own sign-ins.
  const profile = process.env.ZEFF_CHROME_PROFILE || path.join(process.env.LOCALAPPDATA || ".", "Zeff", "chrono-chrome-profile");
  mkdirSync(profile, { recursive: true });
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...urls];
  spawn(chrome, args, { detached: true, stdio: "ignore" }).unref();
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
  if (!up) throw new ChromeConnectError('Started Chrome, but its debug port never came up — close that window and run "npm run chrono:chrome".');
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
    if (!launchUrls.length || !["127.0.0.1", "localhost"].includes(hostname)) {
      throw new ChromeConnectError(
        `The automation Chrome isn't running (nothing answers on ${cdp}). Start it with "npm run chrono:chrome", sign in to Chrono/Punch there if asked, and try again.`,
      );
    }
    launchChrome(port || "9222", launchUrls);
    await waitForLaunch(cdp, launchUrls);
    targets = await listTargets(cdp);
  }
  const tabs = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const answers = await Promise.all(tabs.map((t) => pingTab(t.webSocketDebuggerUrl, 3000)));
  // A busy machine can hold Chrome up for a few seconds: those asked once more, with more time.
  const slow = tabs.filter((_, i) => !answers[i]);
  const again = slow.length ? (await sleep(1500), await Promise.all(slow.map((t) => pingTab(t.webSocketDebuggerUrl, 8000)))) : [];
  const stuck = slow.filter((_, i) => !again[i]);
  if (stuck.length) {
    const names = stuck.map((t) => `“${t.title || t.url}” (${t.url.slice(0, 60)})`).join(", ");
    throw new ChromeConnectError(
      `A tab in the automation Chrome isn't responding: ${names}. Close ${stuck.length === 1 ? "that tab" : "those tabs"} (or dismiss any dialog open there) and try again.`,
    );
  }
  return chromium.connectOverCDP(cdp, { timeout });
}
