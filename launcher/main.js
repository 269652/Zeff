// Zeff launcher (Electron): runs Zeff's Next server (127.0.0.1:9333) and a knowledge server per
// account (127.0.0.1:9555, :9556 …) on the bundled Node, keeps them alive, and serves them over HTTPS —
// https://zeff and https://zeff:1337 (knowledge: https://knowledge.zeff). A tray icon and a
// small status window manage it all. Windows (Zeff.exe), macOS (Zeff.app) and Linux (./zeff).
//
//   Zeff.exe                  tray, opens https://zeff in the browser
//   Zeff.exe --background     tray only (what "Start at log in" runs)
//   Zeff.exe --no-setup       skip the hosts/certificate setup prompt
//   Zeff.exe --config <file>  another zeff-launcher.json
//   Zeff.exe --smoke-test     start everything, check it answers over https, quit (exit code 0 = ok)
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require("electron");
const { execFile } = require("node:child_process");
const { X509Certificate } = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const config = require("./lib/config");
const { log, init: initLog } = require("./lib/log");
const { Service, killLeftovers } = require("./lib/supervisor");
const proxy = require("./lib/proxy");
const tlsCert = require("./lib/tls");
const setup = require("./lib/setup");
const autostart = require("./lib/autostart");
const { startNotifications } = require("./lib/notifications");

const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const flag = (f) => argv.includes(f);
const configFile = argv.includes("--config") ? argv[argv.indexOf("--config") + 1] : undefined;
const smokeTest = flag("--smoke-test");
const PLATFORM = process.platform;
/** What the launcher's texts call the system. */
const SYSTEM = { win32: "Windows", darwin: "macOS" }[PLATFORM] ?? "Linux";
/**
 * The bundle's app/ and runtime/: next to Zeff.exe (Windows) and ./zeff (Linux); in Zeff.app,
 * Contents/Resources/zeff. (In a checkout: the launcher's folder — the checkout is found from there.)
 */
const bundleDir = PLATFORM === "darwin" && app.isPackaged ? path.join(process.resourcesPath, "zeff") : path.dirname(process.execPath);
/** What "Start at log in" and the Linux menu entry run: the ./zeff script when it started us. */
const launcherExe = process.env.ZEFF_LAUNCHER || process.execPath;
const trayIcon = () =>
  PLATFORM === "win32"
    ? path.join(__dirname, "icon.ico")
    : nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: PLATFORM === "darwin" ? 18 : 24 });
const windowIcon = path.join(__dirname, PLATFORM === "win32" ? "icon.ico" : "icon.png");

app.setName("Zeff");
app.setAppUserModelId("Zeff.Launcher");
app.disableHardwareAcceleration();
// Lives in the menu bar, not the Dock.
if (PLATFORM === "darwin") app.dock?.hide();

// A smoke test runs beside a running Zeff: its own Electron profile, so its own single-instance lock.
if (smokeTest) app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "zeff-smoke-profile-")));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

/** Everything the tray and the status window show. */
const state = {
  cfg: null,
  paths: null,
  cert: null,
  services: [],
  /** The Zeff account Zeff is in (data\knowledge-instances.json): its knowledge server is https://knowledge.zeff. */
  activeAccount: "default",
  httpsPorts: [],
  url: "",
  hosts: false,
  trusted: false,
  autostart: false,
  /** Zeff runs as `next dev` (hot reload) instead of `next start` on the last build. */
  dev: false,
};
let tray = null;
let win = null;
let quitting = false;
let exitCode = 0;

const zeff = () => state.services.find((s) => s.name === "Zeff");
/** The knowledge servers — one per Zeff account with the Knowledge plugin (`s.account`). */
const knowledges = () => state.services.filter((s) => s.account);
/** The one of the account Zeff is in (https://knowledge.zeff goes there); else the first account's. */
const activeKnowledge = () => knowledges().find((s) => s.account === state.activeAccount) ?? knowledges().find((s) => s.account === "default") ?? knowledges()[0];
/**
 * A knowledge server's address: the active account's by name (https://knowledge.zeff) — the others,
 * and all of them without the hosts entry, straight on their port (the proxy tells them apart by name only).
 */
const knowledgeUrl = (s = activeKnowledge()) =>
  s && s === activeKnowledge() && state.hosts ? state.url.replace(`://${state.cfg.host}`, `://${state.cfg.knowledgeHost}`) : `http://127.0.0.1:${s?.port ?? state.cfg.knowledgePort}`;

/**
 * https://zeff (the port only when 443 couldn't be had) — or, while the hosts entry is missing,
 * https://127.0.0.1:1337 (the certificate has the address too; another https port when 1337 isn't
 * ours); without any https port, Zeff itself on http://127.0.0.1:9333.
 */
function refreshUrl() {
  const { cfg, paths, httpsPorts } = state;
  state.hosts = setup.hostsOk(cfg.hostsNames);
  if (!httpsPorts.length) state.url = `http://127.0.0.1:${cfg.zeffPort}`;
  else if (state.hosts) state.url = `https://${cfg.host}${httpsPorts.includes(443) ? "" : `:${httpsPorts[0]}`}`;
  else {
    const port = httpsPorts.includes(1337) ? 1337 : (httpsPorts.find((p) => p !== 443) ?? httpsPorts[0]);
    state.url = `https://127.0.0.1${port === 443 ? "" : `:${port}`}`;
  }
  fs.writeFileSync(path.join(paths.state, "url"), state.url);
}

function snapshot() {
  return {
    url: state.url,
    knowledgeUrl: state.cfg.knowledge ? knowledgeUrl() : null,
    httpsPorts: state.httpsPorts,
    hosts: state.hosts,
    trusted: state.trusted,
    autostart: state.autostart,
    host: state.cfg.host,
    services: state.services.map((s) => s.snapshot()),
  };
}

let refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setImmediate(() => {
    refreshQueued = false;
    if (tray) {
      tray.setContextMenu(buildMenu());
      tray.setToolTip(`Zeff · ${state.url}\n${state.services.map((s) => `${s.name}: ${s.label}`).join("\n")}`.slice(0, 127));
    }
    win?.webContents.send("state", snapshot());
  });
}

function serviceMenu(s, extra = []) {
  const st = s.status;
  return {
    label: `${s.name}: ${s.label}`,
    submenu: [
      ...extra,
      { label: "Start", enabled: st === "stopped" || st === "notBuilt", click: () => s.start() },
      { label: "Stop", enabled: ["starting", "running", "crashed"].includes(st), click: () => s.stop() },
      { label: "Restart", enabled: ["starting", "running", "crashed"].includes(st), click: () => s.restart() },
      { type: "separator" },
      { label: "Open log", click: () => shell.openPath(s.logFile) },
    ],
  };
}

/** Zeff as `next dev` (hot reload, no deploy) or `next start` - kept across launcher starts. The port stays, so the proxy and https need nothing. */
function setDev(on) {
  state.dev = on;
  try {
    const f = path.join(state.paths.state, "dev-mode");
    if (on) fs.writeFileSync(f, "");
    else fs.rmSync(f, { force: true });
  } catch (e) {
    log(`dev mode flag: ${e.message}`);
  }
  log(`Zeff: ${on ? "dev mode (next dev, hot reload)" : "production mode (next start)"}`);
  zeff()?.restart();
  refresh();
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Open Zeff", click: () => shell.openExternal(state.url) },
    { label: "Status…", click: showWindow },
    { type: "separator" },
    serviceMenu(zeff()),
    ...state.services.filter((s) => s.name === "Work" || s.name === "Sync").map((w) => serviceMenu(w)),
    ...knowledges().map((k) => serviceMenu(k, [{ label: "Open knowledge", click: () => shell.openExternal(knowledgeUrl(k)) }, { type: "separator" }])),
    { label: "Dev mode (hot reload)", type: "checkbox", checked: state.dev, click: (item) => setDev(item.checked) },
    { type: "separator" },
    { label: "Open data folder", click: () => shell.openPath(state.paths.data) },
    { label: "Open plugins folder", click: openPluginsFolder },
    { label: PLATFORM === "win32" ? "Start with Windows" : "Start at log in", type: "checkbox", checked: state.autostart, click: (item) => toggleAutostart(item.checked) },
    { label: `Set up https://${state.cfg.host}…`, click: () => machineSetup(true) },
    { type: "separator" },
    { label: "Quit Zeff", click: () => app.quit() },
  ]);
}

/**
 * External plugins (docs/plugins): a folder in the data folder — made if it isn't there yet. The servers read
 * the same place (ZEFF_PLUGINS_DIR from zeff-launcher.json's "env" overrides it for both).
 */
function openPluginsFolder() {
  const dir = state.cfg.env?.ZEFF_PLUGINS_DIR ? path.resolve(state.cfg.env.ZEFF_PLUGINS_DIR) : path.join(state.paths.data, "plugins");
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

function showWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 480,
    height: 480,
    resizable: true,
    minimizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    title: "Zeff",
    icon: windowIcon,
    backgroundColor: "#fafafa",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "status.html"));
  win.on("closed", () => (win = null));
  // Links open in the browser, never inside the launcher.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

/** The launcher's arguments (in a checkout, electron's: the launcher folder first) — plus `extra`. */
const launcherArgs = (...extra) => (app.isPackaged ? extra : [app.getAppPath(), ...extra]);

async function toggleAutostart(on) {
  const ok = on
    ? await autostart.enable({ exe: launcherExe, args: launcherArgs("--background"), stateDir: state.paths.state, icon: windowIcon })
    : await autostart.disable();
  if (!ok) dialog.showErrorBox("Zeff", "Couldn't change starting Zeff at log in.");
  state.autostart = await autostart.enabled();
  refresh();
}

/**
 * The admin part — hosts entry and machine-wide trust — when it's missing. Asked once; "No" is
 * remembered (data\launcher\setup-declined) until "Set up https://zeff…" (`forced`).
 */
async function machineSetup(forced) {
  const { cfg, paths, cert } = state;
  const declined = path.join(paths.state, "setup-declined");
  state.trusted = await setup.caTrusted(cert);
  refreshUrl();
  if (state.hosts && state.trusted) {
    if (forced) dialog.showMessageBox({ type: "info", title: "Zeff", message: `https://${cfg.host} is set up.`, detail: "The hosts entry is there and the certificate is trusted." });
    return refresh();
  }
  if (!forced && fs.existsSync(declined)) return refresh();

  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Zeff",
    buttons: ["Set up", "Not now"],
    defaultId: 0,
    cancelId: 1,
    message: `Set up https://${cfg.host} on this computer?`,
    detail:
      `• The hosts file gets "127.0.0.1 ${cfg.hostsNames.join(" ")}".\n` +
      `• ${SYSTEM} trusts Zeff's own certificate. It was made on this computer and its signing key was deleted right away, so it can't vouch for anything else.\n\n` +
      `${SYSTEM} will ask for admin rights${PLATFORM === "darwin" ? ", then once more for your password to trust the certificate" : ""}. Without them Zeff runs on https://127.0.0.1:1337.`,
  });
  let result = "declined";
  if (response === 0) {
    result = await setup.runElevated({ caCer: cert.caCer, names: cfg.hostsNames, logFile: path.join(paths.logs, "launcher.log") });
    if (result === "failed") dialog.showErrorBox("Zeff", `The setup didn't finish. Details are in ${path.join(paths.logs, "launcher.log")}.`);
  }
  if (result === "done") fs.rmSync(declined, { force: true });
  else fs.writeFileSync(declined, "");

  state.trusted = await setup.caTrusted(cert);
  if (!state.trusted) {
    // Trust it at least for this user (no admin; the system asks once).
    await setup.trustForUser(cert.caCer);
    state.trusted = await setup.caTrusted(cert);
  }
  refreshUrl();
  log(`setup: hosts ${state.hosts ? "ok" : "missing"}, certificate ${state.trusted ? "trusted" : "NOT trusted"}; serving ${state.url}`);
  refresh();
}

function fail(message) {
  log(message);
  dialog.showErrorBox("Zeff", message);
  app.exit(1);
}

async function start() {
  let loaded;
  try {
    loaded = config.load({ bundleDir, codeDir: __dirname, configFile });
  } catch (e) {
    return fail(e.message);
  }
  const { cfg, paths } = loaded;
  Object.assign(state, { cfg, paths });
  initLog(path.join(paths.logs, "launcher.log"));
  log(`launcher ${app.getVersion()} (Electron ${process.versions.electron}, ${PLATFORM}) — app ${paths.app}, data ${paths.data}, node ${paths.node}`);
  if (PLATFORM === "darwin" && app.isPackaged) unquarantine();

  try {
    state.cert = await tlsCert.ensure(path.join(paths.state, "tls"), cfg.certNames);
  } catch (e) {
    return fail(e.message);
  }

  // Servers a killed launcher left behind.
  const pidsFile = path.join(paths.state, "pids.json");
  await killLeftovers(pidsFile);

  const next = path.join(paths.app, "node_modules", "next", "dist", "bin", "next");
  // Data outside the app folder (the macOS and Linux bundles, "dataDir"): the servers are told where.
  const ownData = path.resolve(paths.data) !== path.resolve(paths.app, "data");
  // The work host and Zeff's server share a token: only they may start a worker (kept, so a host that outlived the launcher still matches).
  const tokenFile = path.join(paths.state, "work-token");
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, require("node:crypto").randomBytes(24).toString("hex"), { mode: 0o600 });
  const workToken = fs.readFileSync(tokenFile, "utf8").trim();
  // Zeff's server and the sync host share a token: only they may talk to each other (kept, like the work host's).
  const syncTokenFile = path.join(paths.state, "sync-token");
  if (!fs.existsSync(syncTokenFile)) fs.writeFileSync(syncTokenFile, require("node:crypto").randomBytes(24).toString("hex"), { mode: 0o600 });
  const syncToken = fs.readFileSync(syncTokenFile, "utf8").trim();
  // The sync host runs from a build of its own (.next-sync: a deploy swaps .next under the pages' server, not under it).
  const syncDist = ".next-sync";
  const syncMarker = path.join(paths.app, syncDist, "BUILD_ID");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    ZEFF_URL: `http://127.0.0.1:${cfg.zeffPort}`,
    KNOWLEDGE_URL: `http://127.0.0.1:${cfg.knowledgePort}`,
    ...(cfg.workHost ? { ZEFF_WORK_HOST: `http://127.0.0.1:${cfg.workPort}`, ZEFF_WORK_PORT: String(cfg.workPort), ZEFF_WORK_TOKEN: workToken, ZEFF_WORK_STATE: path.join(paths.state, "work-host.json") } : {}),
    // The servers start node for their drivers (process.execPath) — and `node`/`npx` from PATH.
    PATH: `${path.dirname(paths.node)}${path.delimiter}${process.env.PATH ?? ""}`,
    ...(ownData ? { DATABASE_PATH: path.join(paths.data, "zeff.db"), ZEFF_CALENDAR_INBOX: path.join(paths.data, "calendar-inbox.json") } : {}),
    ...cfg.env,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const spec = (name, dir, port) => ({
    name,
    port,
    node: paths.node,
    args: [next, "start", ...(dir ? [dir] : []), "-H", "127.0.0.1", "-p", String(port)],
    cwd: paths.app,
    env,
    logFile: path.join(paths.logs, `${name.toLowerCase()}.log`),
    buildMarker: path.join(paths.app, ...(dir ? [dir] : []), ".next", "BUILD_ID"),
  });
  const savePids = () =>
    fs.writeFileSync(pidsFile, JSON.stringify(Object.fromEntries(state.services.map((s) => [s.name, { pid: s.pid, port: s.port }]))));
  const add = (s) => {
    state.services.push(s);
    s.on("change", () => {
      savePids();
      refresh();
    });
    if (cfg.autostartServers) s.start();
    return s;
  };
  // Zeff's server hands its syncs and runs to the sync host while the host's build is there — else it does them itself.
  // Dev mode (tray, --dev, "dev": true): `next dev` on the same port - no build needed, edits show at once. It writes .next/dev,
  // not the build `npm run deploy` swaps; the sync host goes on running its own build, so its code is only as new as the last deploy.
  state.dev = cfg.dev === true || flag("--dev") || fs.existsSync(path.join(paths.state, "dev-mode"));
  const zeffSpec = spec("Zeff", null, cfg.zeffPort);
  zeffSpec.args = () => [next, state.dev ? "dev" : "start", "-H", "127.0.0.1", "-p", String(cfg.zeffPort)];
  zeffSpec.buildMarker = () => (state.dev ? path.join(paths.app, "package.json") : path.join(paths.app, ".next", "BUILD_ID"));
  zeffSpec.env = () => {
    const e =
      cfg.syncHost && fs.existsSync(syncMarker)
        ? { ...env, ZEFF_ROLE: "web", ZEFF_SYNC_HOST: `http://127.0.0.1:${cfg.syncPort}`, ZEFF_SYNC_TOKEN: syncToken }
        : { ...env };
    // next dev refuses cross-origin dev assets and the HMR socket, and the browser's origin is https://zeff.
    return state.dev ? { ...e, NODE_ENV: "development", ZEFF_DEV_ORIGINS: cfg.hostsNames.join(",") } : e;
  };
  add(new Service(zeffSpec));
  if (cfg.syncHost) {
    const hostSpec = spec("Sync", null, cfg.syncPort);
    add(new Service({ ...hostSpec, env: { ...env, ZEFF_ROLE: "sync", ZEFF_SYNC_TOKEN: syncToken, ZEFF_DIST_DIR: syncDist }, buildMarker: syncMarker }));
  }
  // The work host: plain Node, outside Next. A deploy restarts Zeff's server, not this — the workers it started go on.
  if (cfg.workHost) {
    const hostScript = path.join(paths.app, "scripts", "work-host.mjs");
    add(new Service({ ...spec("Work", null, cfg.workPort), args: [hostScript], buildMarker: hostScript }));
  }

  const routes = { knowledgeHost: cfg.knowledge ? cfg.knowledgeHost : null, zeffPort: cfg.zeffPort, knowledgePort: cfg.knowledgePort };

  // Knowledge servers: one per Zeff account with the Knowledge plugin, as Zeff lists them in
  // data\knowledge-instances.json (each its port, its data folder); without the list (an older
  // Zeff, not started yet) just the first account's on knowledgePort.
  const instancesFile = path.join(paths.data, "knowledge-instances.json");
  // The first account's knowledge data: knowledge/data in the app — or next to Zeff's own data.
  const firstDataDir = ownData ? path.join(paths.data, "knowledge") : null;
  const knowledgeSpec = (k) => {
    const first = k.account === "default";
    const s = spec(first ? "Knowledge" : `Knowledge · ${k.name}`, "knowledge", first ? cfg.knowledgePort : k.port);
    s.logFile = path.join(paths.logs, first ? "knowledge.log" : `knowledge-${k.account}.log`);
    s.env = { ...env, KNOWLEDGE_ACCOUNT: k.account, KNOWLEDGE_ACCOUNT_NAME: first ? "" : k.name, ...(k.dataDir ? { KNOWLEDGE_DATA_DIR: k.dataDir } : {}) };
    return s;
  };
  const reconcile = async () => {
    if (!cfg.knowledge || quitting) return;
    let list = { active: "default", instances: [{ account: "default", name: "Standard", port: cfg.knowledgePort, dataDir: null }] };
    try {
      const v = JSON.parse(fs.readFileSync(instancesFile, "utf8"));
      if (Array.isArray(v.instances)) list = v;
    } catch {}
    state.activeAccount = list.active;
    const wanted = list.instances
      .filter((k) => typeof k?.account === "string" && Number.isInteger(k.port))
      .map((k) => (k.account === "default" && !k.dataDir && firstDataDir ? { ...k, dataDir: firstDataDir } : k));
    for (const s of knowledges()) {
      const k = wanted.find((x) => x.account === s.account);
      const next = k && knowledgeSpec(k);
      if (next && next.port === s.port && next.env.KNOWLEDGE_DATA_DIR === s.spec.env.KNOWLEDGE_DATA_DIR && next.name === s.name) continue;
      log(`[${s.name}] ${k ? "changed" : "no longer wanted (Knowledge uninstalled or account gone)"} — stopping`);
      state.services = state.services.filter((x) => x !== s);
      await s.stop();
      s.dispose();
    }
    for (const k of wanted) {
      if (knowledges().some((s) => s.account === k.account)) continue;
      const s = new Service(knowledgeSpec(k));
      s.account = k.account;
      log(`[${s.name}] knowledge server of account ${k.account} on 127.0.0.1:${s.port}${k.dataDir ? `, data ${k.dataDir}` : ""}`);
      add(s);
    }
    routes.knowledgePort = activeKnowledge()?.port ?? cfg.knowledgePort;
    savePids();
    refresh();
  };
  let reconciling = Promise.resolve();
  const queueReconcile = () => (reconciling = reconciling.then(reconcile).catch((e) => log(`knowledge servers: ${e.message}`)));
  await queueReconcile();
  fs.watchFile(instancesFile, { interval: 2000 }, queueReconcile);
  for (const port of cfg.httpsPorts) {
    const v4 = await proxy.listen(proxy.createHttpsServer({ ...state.cert, routes, listenPort: port }), port, "127.0.0.1");
    // IPv6 only with IPv4: a port someone else holds on 127.0.0.1 (Docker on 443) must not be half
    // ours — a browser picking either address would sometimes get the other's certificate.
    if (v4) await proxy.listen(proxy.createHttpsServer({ ...state.cert, routes, listenPort: port }), port, "::1");
    else log(`https port ${port} is taken on 127.0.0.1 — not used`);
    if (v4) {
      log(`https on 127.0.0.1:${port}`);
      state.httpsPorts.push(port);
    }
  }
  if (cfg.httpRedirect && state.httpsPorts.length) {
    const target = state.httpsPorts.includes(443) ? 443 : state.httpsPorts[0];
    await proxy.listen(proxy.createRedirectServer(target), 80, "127.0.0.1");
  }

  refreshUrl();
  state.autostart = await autostart.enabled();
  tray = new Tray(trayIcon());
  tray.on("click", showWindow);
  refresh();
  log(`serving ${state.url} (zeff:${cfg.zeffPort} knowledge:${cfg.knowledgePort})`);

  if (smokeTest) return runSmokeTest();
  if (!flag("--no-setup")) await machineSetup(false);
  else state.trusted = await setup.caTrusted(state.cert);
  refresh();
  autostart.ensureMenuEntry({ exe: launcherExe, args: launcherArgs(), icon: windowIcon });
  // Zeff's notifications as desktop notifications.
  startNotifications({
    appId: "Zeff.Launcher",
    exe: process.execPath,
    args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
    zeffPort: cfg.zeffPort,
    url: () => state.url,
    stateDir: paths.state,
    icon: windowIcon,
  });
  if (!flag("--background")) shell.openExternal(state.url);
}

/**
 * macOS: what the browser unzipped is quarantined — every file in Zeff.app. Once its user has
 * opened Zeff.app (Gatekeeper asked them), the bundled Node and the native modules must be able
 * to run too, so the quarantine flag comes off Zeff's own files.
 */
function unquarantine() {
  execFile("xattr", ["-dr", "com.apple.quarantine", bundleDir], (e) => {
    if (e && !/No such xattr/i.test(e.message)) log(`xattr: ${e.message.trim()}`);
  });
}

/** The pages a smoke test opens (https://zeff<path>) after the start page of each server. */
const SMOKE_PAGES = ["/heute", "/todos", "/mail", "/kanban", "/plugins", "/sync-settings", "/auswerten", "/logins", "/feierabend", "/work", "/setup", "/jira", "/repos", "/documents", "/ext/docs", "/ext/docs/api", "/ext/raw/README", "/ext/sdk/zeff.js", "/ext/sdk/zeff-plugin.schema.json"];

/** What a smoke page must show (its own content, not an error page): the plugin docs and what they serve. */
const SMOKE_CONTENT = { "/ext/docs": "external plugins", "/ext/docs/api": "extension API", "/ext/raw/README": "# Zeff external plugins", "/ext/sdk/zeff.js": "window.zeff", "/ext/sdk/zeff-plugin.schema.json": "apiVersion" };

/**
 * --smoke-test: the bundle as its user gets it, checked end to end — the servers start on the
 * bundled Node (native modules included), the certificate is made, and Zeff and the knowledge
 * server answer over https through the proxy, verified against Zeff's own CA, and the pages of SMOKE_PAGES render. Then quit.
 */
async function runSmokeTest() {
  const deadline = Date.now() + 5 * 60 * 1000;
  const wanted = () => [zeff(), ...state.services.filter((s) => s.name === "Work" || s.name === "Sync"), ...(state.cfg.knowledge ? [activeKnowledge()] : [])];
  // The status — or, with `text`, { status, body } (the first 2 MB).
  const get = (host, urlPath = "/", text = false) =>
    new Promise((resolve, reject) => {
      const req = https.get(
        {
          host: "127.0.0.1",
          port: state.httpsPorts.find((p) => p !== 443) ?? state.httpsPorts[0],
          path: urlPath,
          servername: host,
          headers: { host },
          ca: new X509Certificate(fs.readFileSync(state.cert.caCer)).toString(), // PEM (Windows exports DER)
          timeout: 60000,
        },
        (res) => {
          let body = "";
          if (text) res.setEncoding("utf8").on("data", (d) => body.length < 2e6 && (body += d));
          else res.resume();
          res.on("end", () => resolve(text ? { status: res.statusCode, body } : res.statusCode));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
  const failed = (why) => {
    log(`smoke test FAILED: ${why}`);
    exitCode = 1;
    app.quit();
  };
  try {
    if (!state.httpsPorts.length) return failed("no https port");
    while (!wanted().every((s) => s?.status === "running")) {
      const now = state.services.map((s) => `${s.name}: ${s.status}`).join(", ");
      if (Date.now() > deadline) return failed(`not running after 5 minutes (${now})`);
      if (state.services.some((s) => s.restarts >= 2)) return failed(`a server keeps crashing (${now}) — see ${state.paths.logs}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const host of [state.cfg.host, ...(state.cfg.knowledge ? [state.cfg.knowledgeHost] : [])]) {
      const status = await get(host);
      log(`smoke test: https://${host}/ → ${status}`);
      if (!(status >= 200 && status < 400)) return failed(`https://${host}/ answered ${status}`);
    }
    // The pages Zeff's deploy script probes (scripts/deploy.mjs) and the ones a new bundle opens first: each renders — a missing file, a
    // native module that doesn't load or a database that didn't migrate shows as a 500 here.
    for (const page of SMOKE_PAGES) {
      const { status, body } = await get(state.cfg.host, page, true);
      log(`smoke test: https://${state.cfg.host}${page} → ${status}`);
      if (!(status >= 200 && status < 400)) return failed(`https://${state.cfg.host}${page} answered ${status}`);
      // A page that fails while it streams still answers 200: React leaves its error in the HTML (data-dgst, $RX).
      if (/data-dgst=|\$RX\(/.test(body)) return failed(`https://${state.cfg.host}${page} rendered an error (see the server log)`);
      const want = SMOKE_CONTENT[page];
      if (want && !body.includes(want)) return failed(`https://${state.cfg.host}${page} doesn't contain "${want}"`);
    }
    log("smoke test passed");
    app.quit();
  } catch (e) {
    failed(e.message);
  }
}

ipcMain.handle("state", () => snapshot());
ipcMain.handle("do", async (_e, action, name) => {
  const s = state.services.find((x) => x.name === name);
  switch (action) {
    case "start":
    case "stop":
    case "restart":
      await s?.[action]();
      break;
    case "log":
      if (s) shell.openPath(s.logFile);
      break;
    case "open":
      shell.openExternal(s?.account ? knowledgeUrl(s) : state.url);
      break;
    case "data":
      shell.openPath(state.paths.data);
      break;
    case "plugins":
      openPluginsFolder();
      break;
    case "setup":
      await machineSetup(true);
      break;
    case "autostart":
      await toggleAutostart(!state.autostart);
      break;
    case "quit":
      app.quit();
      break;
  }
  refresh();
  return snapshot();
});

app.on("second-instance", (_e, args) => {
  if (!args.includes("--background") && state.url) shell.openExternal(state.url);
});

// Lives in the tray: closing the status window doesn't quit.
app.on("window-all-closed", () => {});

app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  log("quitting");
  Promise.all(state.services.map((s) => s.stop()))
    .catch(() => {})
    .finally(() => {
      state.services.forEach((s) => s.dispose());
      log("bye");
      app.exit(exitCode);
    });
});

app.whenReady().then(async () => {
  // macOS runs an app opened from Downloads from a read-only copy (App Translocation) — Next can't
  // keep its cache there. From Applications it runs where it is.
  if (PLATFORM === "darwin" && app.isPackaged && !smokeTest && process.execPath.includes("/AppTranslocation/")) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Zeff",
      buttons: ["Move to Applications", "Not now"],
      defaultId: 0,
      cancelId: 1,
      message: "Move Zeff to the Applications folder?",
      detail: "macOS runs Zeff from a read-only copy until it's in Applications. Your data isn't in Zeff.app — it stays where it is.",
    });
    if (response === 0 && app.moveToApplicationsFolder()) return;
  }
  await start();
});
