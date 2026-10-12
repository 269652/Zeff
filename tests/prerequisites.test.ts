import assert from "node:assert/strict";
import test from "node:test";
import { NO_BROWSER_MESSAGE, browserCandidates, chromeProfileDir, findBrowser, zeffUserDir } from "../scripts/browser-find.mjs";
import { PREREQ_PLUGINS, findCommand, findGit, findUvx, installCommand, relevantRows, resolveBareCommand, type PrereqId } from "../src/lib/prerequisites-shared";
import { setupTempData } from "./helpers";

const fake = (...files: string[]) => (f: string) => files.includes(f);

/** The automation browser: Chrome first, Edge as the fallback, CHROME_PATH on top — on each system. */
test("browser discovery: Chrome, else Edge (Windows), macOS and Linux places, CHROME_PATH", () => {
  const win = { platform: "win32", env: { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, home: "C:\\Users\\a" };
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assert.equal(findBrowser({ ...win, exists: fake(chrome, edge) })?.path, chrome);
  const onlyEdge = findBrowser({ ...win, exists: fake(edge) });
  assert.deepEqual([onlyEdge?.id, onlyEdge?.path], ["edge", edge]);
  assert.equal(findBrowser({ ...win, exists: fake() }), null);
  assert.match(NO_BROWSER_MESSAGE, /CHROME_PATH/);
  // A user-level Chrome install (no admin rights).
  const perUser = "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(findBrowser({ ...win, exists: fake(perUser) })?.path, perUser);

  // CHROME_PATH wins when it exists, is ignored when it doesn't.
  const own = "D:\\Browsers\\brave.exe";
  assert.deepEqual(findBrowser({ ...win, env: { ...win.env, CHROME_PATH: own }, exists: fake(own, chrome) }), { id: "brave", name: "CHROME_PATH", path: own });
  assert.equal(findBrowser({ ...win, env: { ...win.env, CHROME_PATH: own }, exists: fake(chrome) })?.path, chrome);

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const macEdge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
  const mac = { platform: "darwin", env: {}, home: "/Users/a" };
  assert.equal(findBrowser({ ...mac, exists: fake(macEdge, macChrome) })?.path, macChrome);
  assert.equal(findBrowser({ ...mac, exists: fake(macEdge) })?.id, "edge");
  assert.equal(findBrowser({ ...mac, exists: fake("/Users/a/Applications/Chromium.app/Contents/MacOS/Chromium") })?.id, "chromium");

  const linux = { platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, home: "/home/a" };
  assert.equal(findBrowser({ ...linux, exists: fake("/usr/bin/chromium") })?.id, "chromium");
  assert.equal(findBrowser({ ...linux, exists: fake("/usr/bin/chromium", "/usr/local/bin/google-chrome-stable") })?.path, "/usr/local/bin/google-chrome-stable");
  assert.equal(findBrowser({ ...linux, exists: fake("/usr/bin/microsoft-edge") })?.id, "edge");
  assert.equal(findBrowser({ ...linux, exists: fake("/opt/google/chrome/chrome") })?.id, "chrome");
  // Every system lists something to look for.
  for (const platform of ["win32", "darwin", "linux"]) assert.ok(browserCandidates({ platform, env: {}, home: "/h" }).length >= 4, platform);
});

/** The profile folder is per system, outside the app; ZEFF_CHROME_PROFILE overrides. */
test("the automation browser's profile: %LOCALAPPDATA%\\Zeff, Application Support, ~/.local/share/zeff", () => {
  assert.equal(zeffUserDir({ platform: "win32", env: { LOCALAPPDATA: "C:\\L" }, home: "C:\\U" }), "C:\\L\\Zeff");
  assert.equal(zeffUserDir({ platform: "win32", env: {}, home: "C:\\U" }), "C:\\U\\AppData\\Local\\Zeff");
  assert.equal(zeffUserDir({ platform: "darwin", env: {}, home: "/Users/a" }), "/Users/a/Library/Application Support/Zeff");
  assert.equal(zeffUserDir({ platform: "linux", env: {}, home: "/home/a" }), "/home/a/.local/share/zeff");
  assert.equal(zeffUserDir({ platform: "linux", env: { XDG_DATA_HOME: "/x" }, home: "/home/a" }), "/x/zeff");
  assert.equal(chromeProfileDir({ platform: "linux", env: {}, home: "/home/a" }), "/home/a/.local/share/zeff/chrono-chrome-profile");
  assert.equal(chromeProfileDir({ platform: "win32", env: { LOCALAPPDATA: "C:\\L" }, home: "C:\\U" }), "C:\\L\\Zeff\\chrono-chrome-profile");
  assert.equal(chromeProfileDir({ platform: "linux", env: { ZEFF_CHROME_PROFILE: "/p" }, home: "/home/a" }), "/p");
});

/** Finding a program: the PATH (Windows: .exe / .cmd), then the folders installers use. */
test("findCommand / findGit / findUvx with a fake filesystem", () => {
  const win = { platform: "win32", pathEnv: "C:\\Windows\\System32;C:\\tools", home: "C:\\Users\\a" };
  assert.equal(findCommand("uvx", { ...win, exists: fake("C:\\tools\\uvx.exe") }), "C:\\tools\\uvx.exe");
  assert.equal(findCommand("uvx", { ...win, exists: fake() }), null);
  // Git for Windows on a PC where its folder isn't on the server's PATH.
  assert.equal(findGit({ ...win, exists: fake("C:\\Program Files\\Git\\cmd\\git.exe") }), "C:\\Program Files\\Git\\cmd\\git.exe");
  // uv's installer puts uvx in ~/.local/bin — not on the PATH of a server started before.
  assert.equal(findUvx({ ...win, exists: fake("C:\\Users\\a\\.local\\bin\\uvx.exe") }), "C:\\Users\\a\\.local\\bin\\uvx.exe");
  assert.equal(findUvx({ platform: "linux", pathEnv: "/usr/bin", home: "/home/a", exists: fake("/home/a/.local/bin/uvx") }), "/home/a/.local/bin/uvx");
  assert.equal(findUvx({ platform: "linux", pathEnv: "/usr/bin", home: "/home/a", exists: fake() }), null);
  // "uvx" as the Jira config names it: found in uv's folder too; other commands and paths stay as they are.
  const uvx = "/home/a/.local/bin/uvx";
  assert.equal(resolveBareCommand("uvx", { platform: "linux", pathEnv: "/usr/bin", home: "/home/a", exists: fake(uvx) }), uvx);
  assert.equal(resolveBareCommand("uvx", { platform: "linux", pathEnv: "/usr/bin", home: "/home/a", exists: fake() }), "uvx");
  assert.equal(resolveBareCommand("/opt/x/uvx", { platform: "linux", exists: fake(uvx) }), "/opt/x/uvx");
  assert.equal(resolveBareCommand("node", { platform: "linux", exists: fake("/usr/bin/node") }), "node");
  assert.match(installCommand("git", "win32"), /winget/);
  assert.match(installCommand("uv", "darwin"), /brew/);
  assert.match(installCommand("uv", "linux"), /astral\.sh/);
});

/** A row shows when a plugin that needs it is installed; Jira on another command doesn't need uv. */
test("relevantRows: only what the installed plugins need", () => {
  const rows = (Object.keys(PREREQ_PLUGINS) as PrereqId[]).map((id) => ({ id }));
  const ids = (installed: string[], jiraCommand?: string | null) => relevantRows(rows, new Set(installed), { jiraCommand }).map((r) => r.id);
  assert.deepEqual(ids([]), []);
  assert.deepEqual(ids(["chrono"]), ["browser"]);
  assert.deepEqual(ids(["work", "claude-cli", "codex-cli"]), ["git", "claude", "codex"]);
  assert.deepEqual(ids(["documents", "jira"]), ["uv", "poppler"]);
  assert.deepEqual(ids(["jira"], "uvx"), ["uv"]);
  assert.deepEqual(ids(["jira"], "C:\\Users\\a\\.local\\bin\\uvx.exe"), ["uv"]);
  assert.deepEqual(ids(["jira"], "node"), []);
});

test("git missing → a message that says what to install; the Jira server missing → uv's install command", async () => {
  setupTempData();
  const { gitFailure, gitMissingMessage } = await import("../src/lib/git");
  const enoent = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
  assert.equal(gitFailure(enoent).message, gitMissingMessage());
  assert.match(gitMissingMessage(), /Git isn't installed.*(winget|apt|xcode-select)/);
  // Any other failure keeps its own words.
  const other = new Error("fatal: not a git repository");
  assert.equal(gitFailure(other), other);
  assert.equal(gitFailure(enoent, "x").message, gitMissingMessage());
  assert.equal(gitFailure(other, "from stderr").message, "from stderr");

  const { notFoundHint, runStdioSession } = await import("../src/lib/jira/mcp-client");
  assert.match(notFoundHint("uvx", enoent), /Install uv \(.+\).*JIRA_MCP_COMMAND/);
  assert.match(notFoundHint("C:\\Users\\a\\.local\\bin\\uvx.exe", enoent), /Install uv/);
  assert.equal(notFoundHint("uvx", new Error("boom")), "");
  await assert.rejects(runStdioSession({ command: "zeff-no-such-program-xyz", args: [], label: "Jira MCP" }, async () => 1, 5000), /Jira MCP.*zeff-no-such-program-xyz.*not found/);
});

test("prerequisites(): every program with its label, use, location and way to get it", async () => {
  setupTempData();
  const { prerequisites, neededPrerequisites } = await import("../src/lib/prerequisites");
  const rows = prerequisites();
  assert.deepEqual(rows.map((r) => r.id), ["browser", "git", "uv", "claude", "codex", "copilot", "poppler"]);
  for (const r of rows) {
    assert.ok(r.label && r.neededFor && r.howToGet, r.id);
    assert.ok(r.found === null || typeof r.found === "string", r.id);
  }
  assert.match(rows.find((r) => r.id === "git")!.howToGet, /Git/);
  // The default plugins (Work, Chrono, Jira, Copilot CLI …) need the browser, git, uv and Copilot — not Codex or Poppler.
  const needed = neededPrerequisites().map((r) => r.id);
  for (const id of ["browser", "git", "copilot"]) assert.ok(needed.includes(id as PrereqId), id);
  // Jira isn't installed by default — uv comes with it.
  assert.ok(!needed.includes("uv"), "no uv without Jira");
  const { setInstalled } = await import("../src/plugins/state");
  setInstalled("jira", true);
  assert.ok(neededPrerequisites().some((r) => r.id === "uv"), "…and with Jira, uv is needed");
  assert.ok(!needed.includes("codex") && !needed.includes("poppler"));
});
