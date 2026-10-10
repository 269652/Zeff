// Zeff's notifications as desktop notifications (Windows toasts, macOS / Linux notifications): every 2 minutes the launcher asks Zeff what's there
// (GET /api/notifications → { items: [{ id, title, body, href, at }] }, ids stable) and shows each
// id once; a click opens it in the browser. The ids shown are kept (data\launcher\notifications.json),
// so a restart doesn't show them again — and the very first time, what's already there is only
// remembered, not shown.
const fs = require("node:fs");
const path = require("node:path");
const { Notification, shell } = require("electron");
const { log } = require("./log");

const EVERY = 2 * 60 * 1000;
const KEEP_IDS = 2000;
/** At most this many toasts at once (the rest are only remembered). */
const AT_ONCE = 5;

/**
 * Toasts need a Start menu shortcut carrying the app's AppUserModelID on Windows — made once.
 * (Its target is this exe; with a checkout's electron.exe, the app folder as its argument.)
 */
function ensureShortcut({ appId, exe, args }) {
  if (process.platform !== "win32") return;
  const dir = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs");
  const lnk = path.join(dir, "Zeff.lnk");
  try {
    const have = fs.existsSync(lnk) ? shell.readShortcutLink(lnk) : null;
    if (have && have.target === exe && have.args === args && have.appUserModelId === appId) return;
    fs.mkdirSync(dir, { recursive: true });
    shell.writeShortcutLink(lnk, have ? "replace" : "create", { target: exe, args, appUserModelId: appId, description: "Zeff", icon: exe, iconIndex: 0 });
  } catch (e) {
    log(`notifications: no Start menu shortcut (${e.message}) — Windows may not show toasts`);
  }
}

/** Start polling. `url()`: the address the browser uses (https://zeff); `stateDir`: where the seen ids are kept. */
function startNotifications({ appId, exe, args, zeffPort, url, stateDir, icon }) {
  if (!Notification.isSupported()) {
    log("notifications: not supported here");
    return () => {};
  }
  ensureShortcut({ appId, exe, args });
  const file = path.join(stateDir, "notifications.json");
  let seen = null; // null: never asked yet — the first answer is only remembered
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(v.seen)) seen = v.seen;
  } catch {}
  const keep = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ seen: seen.slice(-KEEP_IDS) }));
    } catch {}
  };
  const shown = new Set(); // a Notification gone out of scope may lose its click handler

  const toast = (it) => {
    const n = new Notification({ title: String(it.title ?? "Zeff").slice(0, 120), body: String(it.body ?? "").slice(0, 300), icon });
    const href = typeof it.href === "string" ? it.href : "/";
    n.on("click", () => {
      let target;
      try {
        target = new URL(href, url()).toString();
      } catch {
        target = url();
      }
      if (/^https?:/.test(target)) shell.openExternal(target);
    });
    n.on("close", () => shown.delete(n));
    shown.add(n);
    n.show();
  };

  const poll = async () => {
    let items;
    try {
      const r = await fetch(`http://127.0.0.1:${zeffPort}/api/notifications`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return; // a Zeff without the endpoint
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      items = (Array.isArray(data?.items) ? data.items : []).filter((it) => it && it.id != null);
    } catch (e) {
      if (!/ECONNREFUSED|fetch failed/i.test(String(e?.cause?.code ?? e?.message))) log(`notifications: ${e.message}`);
      return; // Zeff not up (yet): asked again next time
    }
    const first = seen === null;
    seen ??= [];
    const fresh = items.filter((it) => !seen.includes(String(it.id)));
    for (const it of fresh) seen.push(String(it.id));
    if (!first) {
      fresh.slice(0, AT_ONCE).forEach(toast);
      if (fresh.length > AT_ONCE) log(`notifications: ${fresh.length - AT_ONCE} more not shown as toasts`);
    }
    if (fresh.length || first) keep();
  };
  const timer = setInterval(poll, EVERY);
  setTimeout(poll, 20000); // shortly after Zeff is up
  return () => clearInterval(timer);
}

module.exports = { startNotifications };
