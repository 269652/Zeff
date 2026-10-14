/**
 * Contracts: what a driver expects of the app it automates (WhatsApp Web, Signal Desktop, …) — kept as
 * DATA in <plugin>/contract.json, next to the adapter that uses it, so a change of the app is a change
 * of a JSON file, not of the code that reads the messages.
 *
 *   modules    module-registry members: { names: [known names], has: ["member:type", …], optional? }
 *   globals    values on the global object: { paths: [path, alternative paths…], type?, optional? }
 *   states     a state object (redux): { from: "reduxStore.getState", has: [paths], optional? }
 *   selectors  DOM: { any: [css, alternative css…], optional?, when?: <selector id that must exist> }
 *   paths      alternative paths of one value (e.g. which chat is open)
 *   texts      words/phrases the app shows (regex sources, any language) — the UI's wording changes too
 *
 * An override file <ZEFF_AUTOMATION_DIR>/<app>.json (default data/automation/) is merged over the
 * defaults, id by id: a quick fix after an update without a new Zeff — an entry replaces the default
 * entry of that id, `null` removes it. See docs/automation.md.
 */
import fs from "node:fs";
import path from "node:path";

const SECTIONS = ["modules", "globals", "states", "selectors", "paths", "texts"];

/** A selector entry as one CSS selector list (its alternatives joined by a comma). */
export const css = (spec) => (spec?.any ?? []).join(", ");

/** The folder of the override files. */
export function overrideDir(env = process.env) {
  if (env.ZEFF_AUTOMATION_DIR) return env.ZEFF_AUTOMATION_DIR;
  const db = env.DATABASE_PATH;
  return path.join(db ? path.dirname(db) : path.join(process.cwd(), "data"), "automation");
}

/** `defaults` with `override` merged in, section by section and id by id. */
export function mergeContract(defaults, override) {
  const out = { ...defaults };
  for (const s of SECTIONS) {
    const merged = { ...(defaults[s] || {}) };
    for (const [id, v] of Object.entries((override && override[s]) || {})) {
      if (v === null) delete merged[id];
      else merged[id] = v;
    }
    if (Object.keys(merged).length) out[s] = merged;
  }
  return out;
}

/**
 * A plugin's contract: its defaults file (a path or file URL) with the override file merged over it.
 * A broken override is ignored (and reported in `overrideError`) — the defaults still work.
 */
export function loadContract(app, defaultsFile, { env = process.env } = {}) {
  const file = String(defaultsFile).startsWith("file:") ? new URL(defaultsFile) : defaultsFile;
  const defaults = JSON.parse(fs.readFileSync(file, "utf8"));
  const overridePath = path.join(overrideDir(env), `${app}.json`);
  let contract = defaults;
  let overridden = false;
  let overrideError = null;
  if (fs.existsSync(overridePath)) {
    try {
      contract = mergeContract(defaults, JSON.parse(fs.readFileSync(overridePath, "utf8")));
      overridden = true;
    } catch (e) {
      overrideError = `${overridePath}: ${String(e?.message || e).slice(0, 120)}`;
    }
  }
  return Object.defineProperties(contract, {
    // Not enumerable: the contract is sent into the page as JSON; these stay here.
    overridden: { value: overridden, enumerable: false },
    overrideError: { value: overrideError, enumerable: false },
  });
}

/**
 * The checks of the probe as a report: { app, ok, drifted, failed, checks, summary }.
 * ok = nothing required is missing; drifted = something works only through a fallback (the contract
 * wants an update, nothing is broken yet).
 */
export function report(app, checks, contract) {
  const failed = checks.filter((c) => c.level === "fail");
  const drift = checks.filter((c) => c.level === "drift");
  const warn = checks.filter((c) => c.level === "warn");
  const name = (c) => `${c.kind} ${c.id}`;
  const parts = [];
  if (failed.length) parts.push(`missing: ${failed.map((c) => `${name(c)} (${c.detail})`).join("; ")}`);
  if (drift.length) parts.push(`found another way (update ${app}'s contract): ${drift.map((c) => `${name(c)} → ${c.detail}`).join("; ")}`);
  if (warn.length) parts.push(`optional, missing: ${warn.map(name).join(", ")}`);
  return {
    app,
    contract: contract?.version ?? null,
    overridden: !!contract?.overridden,
    ...(contract?.overrideError ? { overrideError: contract.overrideError } : {}),
    ok: failed.length === 0,
    drifted: drift.length > 0,
    failed: failed.map((c) => `${c.kind}:${c.id}`),
    drift: drift.map((c) => `${c.kind}:${c.id}`),
    summary: parts.length ? `${failed.length ? "The app changed, a sync may fail" : "The app changed, it still works through a fallback"} — ${parts.join(" · ")}` : "all as expected",
    checks,
  };
}
