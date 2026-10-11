/**
 * Which browser Zeff's automation window runs in, and where its profile lives — on Windows, macOS
 * and Linux. No dependencies: used by scripts/chrome-cdp.mjs (starts the browser), by
 * src/lib/prerequisites.ts (the "This PC" list) and by tests with a fake filesystem.
 *
 * Any Chromium-based browser does (Playwright attaches over the DevTools port): Google Chrome
 * first, then Microsoft Edge — on every Windows 10/11 — Brave, Chromium. CHROME_PATH names one
 * explicitly (a browser's executable) and wins when it exists.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {{ id: string, name: string, path: string }} Browser */
/** @typedef {{ platform?: string, env?: Record<string, string | undefined>, home?: string, exists?: (file: string) => boolean }} Where */

/**
 * The browsers' usual places on a system, in the order to try (the first that exists is used).
 * @param {Where} [where]
 * @returns {Browser[]}
 */
export function browserCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  /** @type {Browser[]} */
  const list = [];
  const add = (id, name, ...files) => files.filter(Boolean).forEach((p) => list.push({ id, name, path: p }));
  if (platform === "win32") {
    const pf = env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    const j = path.win32.join;
    add("chrome", "Google Chrome", j(pf, "Google", "Chrome", "Application", "chrome.exe"), j(pf86, "Google", "Chrome", "Application", "chrome.exe"), j(local, "Google", "Chrome", "Application", "chrome.exe"));
    add("edge", "Microsoft Edge", j(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), j(pf, "Microsoft", "Edge", "Application", "msedge.exe"), j(local, "Microsoft", "Edge", "Application", "msedge.exe"));
    add("brave", "Brave", j(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), j(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    add("chromium", "Chromium", j(local, "Chromium", "Application", "chrome.exe"), j(pf, "Chromium", "Application", "chrome.exe"));
  } else if (platform === "darwin") {
    const apps = ["/Applications", path.posix.join(home, "Applications")];
    for (const [id, name, app, bin] of [
      ["chrome", "Google Chrome", "Google Chrome", "Google Chrome"],
      ["edge", "Microsoft Edge", "Microsoft Edge", "Microsoft Edge"],
      ["brave", "Brave", "Brave Browser", "Brave Browser"],
      ["chromium", "Chromium", "Chromium", "Chromium"],
    ]) add(id, name, ...apps.map((a) => path.posix.join(a, `${app}.app`, "Contents", "MacOS", bin)));
  } else {
    // Linux & co: the PATH's, then the packages' own folders (and snap / flatpak exports).
    const dirs = (env.PATH ?? "").split(":").filter(Boolean);
    const onPath = (names) => dirs.flatMap((d) => names.map((n) => path.posix.join(d, n)));
    add("chrome", "Google Chrome", ...onPath(["google-chrome", "google-chrome-stable"]), "/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable");
    add("edge", "Microsoft Edge", ...onPath(["microsoft-edge", "microsoft-edge-stable"]), "/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge");
    add("brave", "Brave", ...onPath(["brave-browser", "brave"]), "/opt/brave.com/brave/brave-browser", "/usr/bin/brave-browser");
    add("chromium", "Chromium", ...onPath(["chromium", "chromium-browser"]), "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/var/lib/flatpak/exports/bin/org.chromium.Chromium");
  }
  return list;
}

/**
 * The browser to start: CHROME_PATH when it points at a file, else the first usual place that
 * exists. null: none found.
 * @param {Where} [where]
 * @returns {Browser | null}
 */
export function findBrowser(where = {}) {
  const env = where.env ?? process.env;
  const exists = where.exists ?? ((f) => fs.existsSync(/*turbopackIgnore: true*/ f));
  const own = env.CHROME_PATH?.trim();
  if (own && exists(own)) {
    const base = path.basename(own).toLowerCase();
    const id = /msedge|edge/.test(base) ? "edge" : /brave/.test(base) ? "brave" : /chromium/.test(base) ? "chromium" : "chrome";
    return { id, name: "CHROME_PATH", path: own };
  }
  return browserCandidates(where).find((b) => exists(b.path)) ?? null;
}

/**
 * Zeff's per-user folder outside the app: the automation browser's profiles live here (never in
 * the repo or the bundle — a running browser locks files in its profile).
 *   Windows  %LOCALAPPDATA%\Zeff      macOS  ~/Library/Application Support/Zeff      Linux  ~/.local/share/zeff
 * @param {Where} [where]
 */
export function zeffUserDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Zeff");
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Zeff");
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, ".local", "share"), "zeff");
}

/**
 * The first account's automation-browser profile: ZEFF_CHROME_PROFILE, else roar-chrome-profile in Zeff's user folder.
 * @param {Where} [where]
 */
export function chromeProfileDir(where = {}) {
  const env = where.env ?? process.env;
  const join = (where.platform ?? process.platform) === "win32" ? path.win32.join : path.posix.join;
  return env.ZEFF_CHROME_PROFILE?.trim() || join(zeffUserDir(where), "roar-chrome-profile");
}

/** What to tell the user when no browser was found. */
export const NO_BROWSER_MESSAGE =
  "No Chrome-compatible browser found for Zeff's automation window. Install Google Chrome (or Microsoft Edge — it is part of Windows 10/11 —, Brave or Chromium), or set CHROME_PATH to the browser's executable.";
