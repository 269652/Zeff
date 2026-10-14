/**
 * The probe: what the app drivers (WhatsApp Web, Signal Desktop, …) use to find their way in an app
 * that changes under them. It runs IN the page / app — `installProbe` is self-contained (no imports,
 * no closures) so it can be sent over CDP as `(${installProbe})(globalThis)`.
 *
 * It finds things by what they ARE, from a contract (see contract.mjs), not by one fixed name:
 *   - module(spec)  a module of a module registry (WhatsApp Web's `require`): by its known names
 *                   first, else the registry scanned for a module with the wanted members
 *                   ("has": ["loadEarlierMsgs:function"]) — the app renamed it, the driver still works
 *   - global(spec)  a value on the global object (Signal Desktop: ConversationController, …), by path
 *                   with alternatives
 *   - sel/selAll    DOM elements by CSS alternatives ("any": joined with a comma); "transient": only there in some states
 *   - pick          the first alternative path of an object that has a value
 *   - check         the whole contract, read-only: every item OK / DRIFT (found another way) / WARN
 *                   (optional, missing) / FAIL / SKIP — what the self-test and the status report
 *
 * A "has" entry is "path" (exists), "path:type" (typeof). Paths are dotted. Nothing here reads
 * content (no messages, no names): it looks at keys, types and counts.
 *
 * @param {any} g the global object (window / globalThis); tests pass a fake
 * @param {string} [h] a hash of this source: an installed probe of another source is replaced
 */
export function installProbe(g, h) {
  if (g.__zeffProbe && g.__zeffProbe.h === h) return g.__zeffProbe;

  const get = (root, path) => {
    let o = root;
    for (const k of String(path).split(".")) {
      if (o === null || o === undefined) return undefined;
      try {
        o = o[k];
      } catch {
        return undefined;
      }
    }
    return o;
  };
  const typeOk = (v, type) => v !== undefined && v !== null && (!type || typeof v === type);
  const parse = (h) => {
    const i = String(h).lastIndexOf(":");
    return i > 0 ? { path: h.slice(0, i), type: h.slice(i + 1) } : { path: String(h), type: null };
  };
  const shape = (obj, has) => {
    if (!has || !has.length) return false;
    if (obj === null || obj === undefined || (typeof obj !== "object" && typeof obj !== "function")) return false;
    return has.every((h) => {
      const { path, type } = parse(h);
      return typeOk(get(obj, path), type);
    });
  };
  const tokens = (s) => String(s).match(/[A-Z][a-z]+|[a-z]+|\d+/g) || [];
  const similarity = (a, b) => {
    const tb = new Set(tokens(b));
    return tokens(a).filter((t) => tb.has(t)).length;
  };

  /** The module registry of a Metro/Haste-style `require` (WhatsApp Web: require("__debug").modulesMap), or null. */
  const registry = () => {
    try {
      return g.require("__debug").modulesMap || null;
    } catch {
      return null;
    }
  };

  const findModule = (spec) => {
    if (!spec || typeof g.require !== "function") return null;
    const names = spec.names || [];
    // 1. By a known name — the cheap, exact way.
    for (const name of names) {
      let mod;
      try {
        mod = g.require(name);
      } catch {
        continue;
      }
      if (spec.has && spec.has.length ? shape(mod, spec.has) : mod !== undefined && mod !== null) return { mod, via: "name", name };
    }
    // 2. By what it can do: the registry scanned (only modules already initialised, so nothing is run).
    if (!spec.has || !spec.has.length) return null;
    const reg = registry();
    if (!reg) return null;
    const found = [];
    for (const name of Object.keys(reg)) {
      let m;
      try {
        m = reg[name];
      } catch {
        continue;
      }
      let cands;
      try {
        cands = [m && m.defaultExport, m && m.exports && m.exports.default, m && m.exports];
      } catch {
        continue;
      }
      for (const c of cands) {
        if (c && shape(c, spec.has)) {
          found.push({ mod: c, name });
          break;
        }
      }
    }
    if (!found.length) return null;
    // Several: the one whose name is closest to a known name.
    found.sort((a, b) => Math.max(0, ...names.map((n) => similarity(b.name, n))) - Math.max(0, ...names.map((n) => similarity(a.name, n))));
    return { mod: found[0].mod, via: "scan", name: found[0].name, candidates: found.length };
  };

  /** A value on the global object by one of several paths. */
  const global = (spec) => {
    if (!spec) return null;
    const paths = spec.paths || [];
    for (let i = 0; i < paths.length; i++) {
      const v = get(g, paths[i]);
      if (typeOk(v, spec.type) && (!spec.has || !spec.has.length || shape(v, spec.has))) return { value: v, via: i === 0 ? "name" : "alt", name: paths[i] };
    }
    return null;
  };

  /** The first of several paths (of an object) that has a value. */
  const pick = (root, paths) => {
    for (const p of paths || []) {
      const v = get(root, p);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };

  const css = (spec) => (Array.isArray(spec) ? spec : (spec && spec.any) || []).join(", ");
  const sel = (spec, scope) => {
    const q = css(spec);
    return q ? (scope || g.document).querySelector(q) : null;
  };
  const selAll = (spec, scope) => {
    const q = css(spec);
    return q ? [...(scope || g.document).querySelectorAll(q)] : [];
  };
  const re = (list, flags = "i") => new RegExp((list || []).join("|") || "$^", flags);

  const state = (spec) => {
    try {
      const fn = get(g, spec.from);
      return typeof fn === "function" ? fn.call(get(g, spec.from.split(".").slice(0, -1).join(".")) || g) : fn;
    } catch {
      return undefined;
    }
  };

  /** The whole contract, read-only. → [{ kind, id, level, via?, detail? }] */
  const check = (contract) => {
    const out = [];
    const add = (kind, id, level, extra = {}) => out.push({ kind, id, level, ...extra });
    for (const [id, spec] of Object.entries((contract && contract.modules) || {})) {
      let r = null;
      try {
        r = findModule(spec);
      } catch (e) {
        add("module", id, "fail", { detail: String((e && e.message) || e).slice(0, 120) });
        continue;
      }
      if (!r) add("module", id, spec.optional ? "warn" : "fail", { detail: `no module with ${(spec.has || []).join(", ") || (spec.names || []).join(", ")}` });
      else if (r.via === "name") add("module", id, "ok", { via: "name", detail: r.name });
      else add("module", id, "drift", { via: "scan", detail: `found as ${r.name}${r.candidates > 1 ? ` (${r.candidates} candidates)` : ""} — known names: ${(spec.names || []).join(", ")}` });
    }
    for (const [id, spec] of Object.entries((contract && contract.globals) || {})) {
      const r = global(spec);
      if (!r) add("global", id, spec.optional ? "warn" : "fail", { detail: `none of ${(spec.paths || []).join(", ")}${spec.has ? ` with ${spec.has.join(", ")}` : ""}` });
      else add("global", id, r.via === "name" ? "ok" : "drift", { via: r.via, detail: r.name });
    }
    for (const [id, spec] of Object.entries((contract && contract.states) || {})) {
      const root = state(spec);
      const missing = (spec.has || []).filter((h) => {
        const { path, type } = parse(h);
        return !typeOk(get(root, path), type);
      });
      if (root === undefined) add("state", id, spec.optional ? "warn" : "fail", { detail: `${spec.from} gives nothing` });
      else if (missing.length) add("state", id, spec.optional ? "warn" : "fail", { detail: `lacks ${missing.join(", ")}` });
      else add("state", id, "ok");
    }
    for (const [id, spec] of Object.entries((contract && contract.selectors) || {})) {
      if (spec.when && !sel((contract.selectors || {})[spec.when])) {
        add("selector", id, "skip", { detail: `needs ${spec.when}` });
        continue;
      }
      const alts = spec.any || [];
      const counts = alts.map((a) => {
        try {
          return (g.document ? g.document.querySelectorAll(a).length : 0) | 0;
        } catch {
          return 0;
        }
      });
      const hit = counts.findIndex((n) => n > 0);
      // transient: only there in some states (the QR code, your own message in the open chat) — absent is no finding.
      if (hit < 0) add("selector", id, spec.transient ? "skip" : spec.optional ? "warn" : "fail", { detail: `none of ${alts.join(" | ")}${spec.transient ? " (only in some states)" : ""}` });
      else add("selector", id, hit === 0 ? "ok" : "drift", { via: hit === 0 ? "name" : "alt", detail: `${alts[hit]} ×${counts[hit]}` });
    }
    return out;
  };

  const P = { h, get, shape, module: findModule, global, pick, sel, selAll, css, re, state, check };
  g.__zeffProbe = P;
  return P;
}

/** The source to evaluate in a page: installs the probe (and answers nothing — the probe isn't serializable). */
const SOURCE = installProbe.toString();
const hash = [...SOURCE].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7).toString(36);
export const PROBE_SOURCE = `void (${SOURCE})(globalThis, "${hash}")`;
