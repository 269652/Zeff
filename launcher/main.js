// Zeff launcher (Electron): runs Zeff's Next server (127.0.0.1:9333) and a knowledge server per
// account (127.0.0.1:9555, :9556 …) on the bundled node.exe, keeps them alive, and serves them over HTTPS —
// https://zeff and https://zeff:1337 (knowledge: https://knowledge.zeff). A tray icon and a
// small status window manage it all.
//
//   Zeff.exe                  tray, opens https://zeff in the browser
//   Zeff.exe --background     tray only (what "Start with Windows" runs)
//   Zeff.exe --no-setup       skip the hosts/certificate setup prompt
//   Zeff.exe --config <file>  another zeff-launcher.json
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
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

app.setName("Zeff");
app.setAppUserModelId("Zeff.Launcher");
app.disableHardwareAcceleration();

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
};
let tray = null;
let win = null;
let quitting = false;

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

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Open Zeff", click: () => shell.openExternal(state.url) },
    { label: "Status…", click: showWindow },
    { type: "separator" },
    serviceMenu(zeff()),
    ...knowledges().map((k) => serviceMenu(k, [{ label: "Open knowledge", click: () => shell.openExternal(knowledgeUrl(k)) }, { type: "separator" }])),
    { type: "separator" },
    { label: "Open data folder", click: () => shell.openPath(path.join(state.paths.app, "data")) },
    { label: "Start with Windows", type: "checkbox", checked: state.autostart, click: (item) => toggleAutostart(item.checked) },
    { label: `Set up https://${state.cfg.host}…`, click: () => machineSetup(true) },
    { type: "separator" },
    { label: "Quit Zeff", click: () => app.quit() },
  ]);
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
    icon: path.join(__dirname, "icon.ico"),
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

async function toggleAutostart(on) {
  const exe = process.execPath;
  const args = app.isPackaged ? ["--background"] : [app.getAppPath(), "--background"];
  const ok = on ? await autostart.enable({ exe, args, stateDir: state.paths.state }) : await autostart.disable();
  if (!ok) dialog.showErrorBox("Zeff", 'Couldn\'t change the "Zeff Launcher" scheduled task.');
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
  state.trusted = await setup.caTrusted(cert.caThumbprint);
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
      "• Windows trusts Zeff's own certificate. It was made on this computer and its signing key was deleted right away, so it can't vouch for anything else.\n\n" +
      `Windows will ask for admin rights. Without them Zeff runs on https://127.0.0.1:1337.`,
  });
  let result = "declined";
  if (response === 0) {
    result = await setup.runElevated({ caCer: cert.caCer, names: cfg.hostsNames, logFile: path.join(paths.logs, "launcher.log") });
    if (result === "failed") dialog.showErrorBox("Zeff", "The setup didn't finish. Details are in data\\logs\\launcher.log.");
  }
  if (result === "done") fs.rmSync(declined, { force: true });
  else fs.writeFileSync(declined, "");

  state.trusted = await setup.caTrusted(cert.caThumbprint);
  if (!state.trusted) {
    // Trust it at least for this user (no admin; Windows asks once).
    await setup.trustForUser(cert.caCer);
    state.trusted = await setup.caTrusted(cert.caThumbprint);
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
    loaded = config.load({ exeDir: path.dirname(process.execPath), codeDir: __dirname, configFile });
  } catch (e) {
    return fail(e.message);
  }
  const { cfg, paths } = loaded;
  Object.assign(state, { cfg, paths });
  initLog(path.join(paths.logs, "launcher.log"));
  log(`launcher ${app.getVersion()} (Electron ${process.versions.electron}) — app ${paths.app}, node ${paths.node}`);

  try {
    state.cert = await tlsCert.ensure(path.join(paths.state, "tls"), cfg.certNames);
  } catch (e) {
    return fail(e.message);
  }

  // Servers a killed launcher left behind.
  const pidsFile = path.join(paths.state, "pids.json");
  await killLeftovers(pidsFile);

  const next = path.join(paths.app, "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    ZEFF_URL: `http://127.0.0.1:${cfg.zeffPort}`,
    KNOWLEDGE_URL: `http://127.0.0.1:${cfg.knowledgePort}`,
    // The servers start node for their drivers (process.execPath) — and `node`/`npx` from PATH.
    PATH: `${path.dirname(paths.node)};${process.env.PATH ?? ""}`,
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
  add(new Service(spec("Zeff", null, cfg.zeffPort)));

  const routes = { knowledgeHost: cfg.knowledge ? cfg.knowledgeHost : null, zeffPort: cfg.zeffPort, knowledgePort: cfg.knowledgePort };

  // Knowledge servers: one per Zeff account with the Knowledge plugin, as Zeff lists them in
  // data\knowledge-instances.json (each its port, its data folder); without the list (an older
  // Zeff, not started yet) just the first account's on knowledgePort.
  const dataBase = cfg.env.DATABASE_PATH ? path.dirname(path.resolve(paths.app, cfg.env.DATABASE_PATH)) : path.join(paths.app, "data");
  const instancesFile = path.join(dataBase, "knowledge-instances.json");
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
    const wanted = list.instances.filter((k) => typeof k?.account === "string" && Number.isInteger(k.port));
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
  tray = new Tray(path.join(__dirname, "icon.ico"));
  tray.on("click", showWindow);
  refresh();
  log(`serving ${state.url} (zeff:${cfg.zeffPort} knowledge:${cfg.knowledgePort})`);

  if (!flag("--no-setup")) await machineSetup(false);
  else state.trusted = await setup.caTrusted(state.cert.caThumbprint);
  refresh();
  // Zeff's notifications as Windows toasts.
  startNotifications({
    appId: "Zeff.Launcher",
    exe: process.execPath,
    args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
    zeffPort: cfg.zeffPort,
    url: () => state.url,
    stateDir: paths.state,
    icon: path.join(__dirname, "icon.ico"),
  });
  if (!flag("--background")) shell.openExternal(state.url);
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
      shell.openPath(path.join(state.paths.app, "data"));
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
      app.exit(0);
    });
});

app.whenReady().then(start);
