// The nightly restart of Zeff's server: `next dev` (and a long-running `next start`) grows to 4–6 GB over days — a restart in
// the night gives it back. At the set time (default 04:30, local) the launcher restarts the Zeff service once it has been idle
// for a while (no request through the https proxy for 10 minutes); still busy two hours later, that night is skipped. Kept in
// <state>/nightly-restart.json ({ enabled, at, lastDay }), switched in the tray menu.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = { enabled: true, at: "04:30" };
const IDLE_MS = 10 * 60 * 1000;
const WINDOW_MS = 2 * 60 * 60 * 1000;

const two = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const validAt = (at) => typeof at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(at);

/** The last time the restart was due at or before `now` (today's, or yesterday's when today's is still ahead). */
function lastSlot(now, at) {
  const [h, m] = at.split(":").map(Number);
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (slot > now) slot.setDate(slot.getDate() - 1);
  return slot;
}

/**
 * What to do now — a pure decision (the launcher asks it every half minute):
 *   "off"      switched off
 *   "done"     this night's restart happened (or was skipped) already
 *   "wait"     not idle yet (inside the window), or the service isn't running
 *   "restart"  now: due, and no request for `idleMs`
 *   "skip"     the window passed without an idle moment — not tonight
 * `day` is the night it counts for (the slot's date): what to remember as lastDay after "restart" or "skip".
 */
function decide({ now, enabled = DEFAULTS.enabled, at = DEFAULTS.at, lastDay = null, lastActivity = 0, running = true, idleMs = IDLE_MS, windowMs = WINDOW_MS }) {
  if (!enabled) return { action: "off" };
  const slot = lastSlot(now, validAt(at) ? at : DEFAULTS.at);
  const day = dayKey(slot);
  if (lastDay === day) return { action: "done", day };
  if (now.getTime() - slot.getTime() >= windowMs) return { action: "skip", day };
  if (!running) return { action: "wait", day };
  return now.getTime() - lastActivity >= idleMs ? { action: "restart", day } : { action: "wait", day };
}

/** Whether a request through the proxy is someone using Zeff: not Next's own files, not a prefetch. */
const isActivity = (req) => !/^\/_next\/(static|image|webpack-hmr)|^\/favicon/.test(String(req.url ?? "")) && !req.headers?.["next-router-prefetch"] && req.headers?.purpose !== "prefetch";

const file = (stateDir) => path.join(stateDir, "nightly-restart.json");

/** The setting: { enabled, at, lastDay } — the defaults (on, 04:30) when nothing is saved; zeff-launcher.json's own as the base. */
function read(stateDir, cfg = {}) {
  const base = { enabled: cfg.nightlyRestart ?? DEFAULTS.enabled, at: validAt(cfg.nightlyRestartAt) ? cfg.nightlyRestartAt : DEFAULTS.at, lastDay: null };
  try {
    const v = JSON.parse(fs.readFileSync(file(stateDir), "utf8"));
    return { enabled: typeof v.enabled === "boolean" ? v.enabled : base.enabled, at: validAt(v.at) ? v.at : base.at, lastDay: typeof v.lastDay === "string" ? v.lastDay : null };
  } catch {
    return base;
  }
}

function write(stateDir, setting) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = `${file(stateDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ enabled: !!setting.enabled, at: validAt(setting.at) ? setting.at : DEFAULTS.at, lastDay: setting.lastDay ?? null }, null, 2));
  fs.renameSync(tmp, file(stateDir));
}

module.exports = { DEFAULTS, IDLE_MS, WINDOW_MS, decide, isActivity, read, write, lastSlot };
