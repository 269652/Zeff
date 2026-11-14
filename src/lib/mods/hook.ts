import * as React from "react";

/**
 * The hooks of mods (docs/mods.md). The build puts every exported function and component of src/ behind one of these (scripts/mods/
 * hook-loader.cjs): a Proxy that, with no mod on it, only calls the original. A mod registers what it does on a hook's name —
 * before / after / around / replace a function, wrap a component — and from then on the call goes through it.
 *
 * Nothing a mod does may break Zeff: every hook runs guarded — one that throws is passed by (the original runs, or its result is kept),
 * and a mod whose hooks keep failing is switched off; a hook written for an older version of a function (its code's hash) is held back,
 * not applied. Works the same in the browser, in server rendering and on the server: the mods' parts live on globalThis (put there by
 * lib/mods/server.ts on the server and by /api/mods/client.js in the browser); each copy of this module builds its own table from them,
 * with its own React (the browser's, the server renderer's, the server components').
 */

export type HookKind = "before" | "after" | "around" | "replace" | "wrap";
type Fn = (...args: unknown[]) => unknown;
export type ModHost = { React: typeof React; isServer: boolean; require?: (id: string) => unknown };

/** What a mod's part gets: register on hook names. */
export type ModApi = {
  id: string;
  host: ModHost;
  /** Change the arguments (return a new list), or only look at them. */
  before: (hook: string, fn: (args: unknown[]) => unknown[] | void) => void;
  /** Change the result (return the new one), or only look at it (a Promise's value, for an async function). */
  after: (hook: string, fn: (result: unknown, args: unknown[]) => unknown) => void;
  /** Around the call: `next(...args)` calls what is below (the original, or the next mod's hook). */
  around: (hook: string, fn: (next: Fn, ...args: unknown[]) => unknown) => void;
  /** Instead of the original. */
  replace: (hook: string, fn: Fn) => void;
  /** A component drawn instead of the original — it gets the original as `Orig` to draw inside. */
  wrap: (hook: string, fn: (Orig: React.ComponentType<Record<string, unknown>>) => React.ComponentType<Record<string, unknown>>) => void;
  log: (...x: unknown[]) => void;
};

export type ModPart = { mod: string; part: "server" | "client"; targets?: Record<string, string>; /** The accounts it is for (unset: all). */ accounts?: string[]; setup: (host: ModHost) => (api: ModApi) => void };
type Hook = { mod: string; kind: HookKind; fn: Fn; target?: string; accounts?: string[]; cache?: WeakMap<object, unknown> };
export type HookError = { mod: string; hook: string; message: string; at: string };

type Global = {
  version: number;
  parts: ModPart[];
  disabled: Map<string, string>;
  failures: Map<string, number>;
  errors: HookError[];
  stale: Map<string, { mod: string; hook: string }>;
  known: Map<string, { hash: string; kind: string }>;
  safe: boolean;
  /** Each hooked export (the Proxy React and callers see) → its hook's name: what is under the pointer (lib/mods/pick.ts). */
  named?: WeakMap<object, string>;
  /** (The server: the account a call is made for — a mod for some accounts only runs in those. The browser loads only its account's.) */
  account?: () => string | undefined;
  /** (Told when a mod is switched off for failing — the server writes it down, the browser tells the server.) */
  onDisabled?: (mod: string, reason: string) => void;
  /** (The server: looks whether a mod was switched on, off or built since — lib/mods/server.ts; at most once a second.) */
  refresh?: () => void;
  refreshedAt?: number;
};

const MAX_FAILURES = 5;
const g = globalThis as unknown as { __zeffMods?: Global; __zeffModsQueue?: ModPart[] };
export const modsGlobal = (): Global => (g.__zeffMods ??= { version: 0, parts: [], disabled: new Map(), failures: new Map(), errors: [], stale: new Map(), known: new Map(), safe: false });

/** Parts waiting (the browser's script and the server's loader push them): taken in. */
function drain(G: Global): void {
  const q = g.__zeffModsQueue;
  if (!q?.length) return;
  for (const p of q.splice(0)) {
    G.parts = [...G.parts.filter((x) => !(x.mod === p.mod && x.part === p.part)), p];
  }
  G.version++;
}

/** Set the mods' parts (the server's loader: what is on now) — the tables are built again. */
export function setModParts(parts: ModPart[]): void {
  const G = modsGlobal();
  G.parts = parts;
  G.version++;
}

const isServer = typeof window === "undefined";
// In the browser, a mod switched off for failing is told to the server (which writes it down: it stays off on the next load).
if (!isServer) {
  const G0 = modsGlobal();
  G0.onDisabled ??= (mod, reason) => {
    try {
      void fetch("/api/mods/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mod, reason, errors: G0.errors.filter((e) => e.mod === mod).slice(-5) }), keepalive: true });
    } catch {
      /* (said in the console) */
    }
  };
}
// (react-server — the server components' React — has no useState: no error boundaries, no state there)
const isRsc = typeof (React as { useState?: unknown }).useState !== "function";
const host: ModHost = { React, isServer };

let built = -1;
let table = new Map<string, Hook[]>();

function report(G: Global, h: { mod: string }, hook: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  G.errors = [...G.errors.slice(-49), { mod: h.mod, hook, message: message.slice(0, 500), at: new Date().toISOString() }];
  const n = (G.failures.get(h.mod) ?? 0) + 1;
  G.failures.set(h.mod, n);
  if (n >= MAX_FAILURES && !G.disabled.has(h.mod)) {
    const reason = `its hooks failed ${n} times (last: ${hook}: ${message.slice(0, 200)})`;
    G.disabled.set(h.mod, reason);
    G.version++;
    try {
      G.onDisabled?.(h.mod, reason);
    } catch {
      /* (told nobody — it is off anyway) */
    }
  }
  if (typeof console !== "undefined") console.warn(`[mod ${h.mod}] ${hook}: ${message}`);
}

function build(G: Global): Map<string, Hook[]> {
  const t = new Map<string, Hook[]>();
  if (G.safe) return t;
  for (const p of G.parts) {
    if (G.disabled.has(p.mod)) continue;
    const push = (hook: string, kind: HookKind, fn: Fn) => {
      if (typeof hook !== "string" || typeof fn !== "function") return;
      t.set(hook, [...(t.get(hook) ?? []), { mod: p.mod, kind, fn, target: p.targets?.[hook], ...(p.accounts?.length ? { accounts: p.accounts } : {}), ...(kind === "wrap" ? { cache: new WeakMap() } : {}) }]);
    };
    const api: ModApi = {
      id: p.mod,
      host,
      before: (h, fn) => push(h, "before", fn as Fn),
      after: (h, fn) => push(h, "after", fn as Fn),
      around: (h, fn) => push(h, "around", fn as Fn),
      replace: (h, fn) => push(h, "replace", fn),
      wrap: (h, fn) => push(h, "wrap", fn as Fn),
      log: (...x) => console.log(`[mod ${p.mod}]`, ...x),
    };
    try {
      p.setup(host)(api);
    } catch (e) {
      report(G, p, `(setup of its ${p.part} part)`, e);
    }
  }
  return t;
}

function hooksFor(id: string): Hook[] | undefined {
  const G = modsGlobal();
  // (On the server a page may render before the layout loaded a mod just switched on: looked at here too.)
  if (isServer && G.refresh && Date.now() - (G.refreshedAt ?? 0) > 1000) {
    G.refreshedAt = Date.now();
    try {
      G.refresh();
    } catch {
      /* (the mods stay as they were) */
    }
  }
  drain(G);
  if (built !== G.version) {
    built = G.version;
    table = build(G);
  }
  return table.get(id);
}

/** Whether a hook's mod is for the account this call is made for (a mod for all accounts: always). */
function forThisAccount(G: Global, h: Hook): boolean {
  if (!h.accounts) return true;
  let now: string | undefined;
  try {
    now = G.account?.();
  } catch {
    now = undefined;
  }
  return now === undefined || h.accounts.includes(now);
}

const thenable = (v: unknown): v is Promise<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

/** One hook around `next` — guarded: what it breaks is passed by. */
function step(h: Hook, id: string, next: (args: unknown[]) => unknown, kindOfPoint: string, target: Fn): (args: unknown[]) => unknown {
  const G = modsGlobal();
  // eslint-disable-next-line react/display-name -- a step of the call chain, not a component (it may return an element)
  return (args) => {
    if (G.disabled.has(h.mod) || !forThisAccount(G, h)) return next(args);
    switch (h.kind) {
      case "before": {
        let a = args;
        try {
          const r = h.fn(args);
          if (Array.isArray(r)) a = r;
        } catch (e) {
          report(G, h, id, e);
        }
        return next(a);
      }
      case "after": {
        const res = next(args);
        const apply = (v: unknown) => {
          try {
            const r = h.fn(v, args);
            return r === undefined ? v : r;
          } catch (e) {
            report(G, h, id, e);
            return v;
          }
        };
        return thenable(res) ? res.then(apply) : apply(res);
      }
      case "around":
      case "replace": {
        let called = false;
        let value: unknown;
        const nextOnce: Fn = (...x) => {
          called = true;
          value = next(x.length ? x : args);
          return value;
        };
        const fallback = (e: unknown) => {
          report(G, h, id, e);
          return called ? value : next(args);
        };
        try {
          const r = h.kind === "around" ? h.fn(nextOnce, ...args) : h.fn(...args);
          return thenable(r) ? r.then(undefined, fallback) : r;
        } catch (e) {
          return fallback(e);
        }
      }
      case "wrap": {
        if (kindOfPoint !== "component") return next(args);
        // The original as a component the mod draws inside — made once per original (the same component every time: React keeps
        // its state), the mod's component too.
        let made = h.cache!.get(target) as { Orig: React.ComponentType<Record<string, unknown>>; C: React.ComponentType<Record<string, unknown>> } | undefined;
        if (!made) {
          const Orig = ((props: Record<string, unknown>) => target(props)) as React.ComponentType<Record<string, unknown>>;
          (Orig as { displayName?: string }).displayName = `${id.split("#")[1] ?? "Orig"}(original)`;
          try {
            made = { Orig, C: h.fn(Orig) as React.ComponentType<Record<string, unknown>> };
          } catch (e) {
            report(G, h, id, e);
            return next(args);
          }
          h.cache!.set(target, made);
        }
        const { Orig, C } = made;
        if (isServer) {
          // On the server no error boundary catches (server components have none; server rendering doesn't use them): the mod's
          // component is called here, guarded like a function — it throws, the original is drawn.
          try {
            const r = (C as unknown as Fn)(args[0]);
            return thenable(r) ? r.then(undefined, (e) => (report(G, h, id, e), next(args))) : r;
          } catch (e) {
            report(G, h, id, e);
            return next(args);
          }
        }
        return React.createElement(ModBoundary, { mod: h.mod, hook: id, C, Orig, props: (args[0] ?? {}) as Record<string, unknown> });
      }
    }
  };
}

type BoundaryProps = { mod: string; hook: string; C: React.ComponentType<Record<string, unknown>>; Orig: React.ComponentType<Record<string, unknown>>; props: Record<string, unknown> };
/** What a mod draws, guarded: if it throws, the original is drawn instead (and the mod is told off). */
const ModBoundary: React.ComponentType<BoundaryProps> = isRsc
  ? ((() => null) as unknown as React.ComponentType<BoundaryProps>)
  : class ModBoundaryClass extends React.Component<BoundaryProps, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(e: unknown) {
        report(modsGlobal(), { mod: this.props.mod }, this.props.hook, e);
      }
      render() {
        const { C, Orig, props } = this.props;
        return React.createElement(this.state.failed ? Orig : C, props);
      }
    };

/**
 * The hook a hooked export is replaced by (the build writes the call): `name` its hook's name, `hash` its code's, `kind` function or
 * component. Not a function (a class, a value): left as it is.
 */
export function __zeffHook<T>(id: string, fn: T, hash: string, kind: string): T {
  if (typeof fn !== "function") return fn;
  if (/^class[\s{]/.test(Function.prototype.toString.call(fn))) return fn;
  const G0 = modsGlobal();
  G0.known.set(id, { hash, kind });
  const proxy = new Proxy(fn as unknown as Fn, {
    apply(target, thisArg, args: unknown[]) {
      const hooks = hooksFor(id);
      if (!hooks?.length) return Reflect.apply(target, thisArg, args);
      const G = modsGlobal();
      let call = (a: unknown[]) => Reflect.apply(target, thisArg, a);
      for (const h of [...hooks].reverse()) {
        if (h.target && h.target !== hash) {
          // Written for another version of it: held back (said once).
          if (!G.stale.has(`${h.mod}|${id}`)) G.stale.set(`${h.mod}|${id}`, { mod: h.mod, hook: id });
          continue;
        }
        call = step(h, id, call, kind, target);
      }
      return call(args);
    },
  });
  (G0.named ??= new WeakMap()).set(proxy, id);
  return proxy as unknown as T;
}

/** The hook's name of a hooked export (a component React drew, a function): null for anything else. */
export const hookIdOf = (x: unknown): string | null => (x && (typeof x === "function" || typeof x === "object") ? (modsGlobal().named?.get(x as object) ?? null) : null);

/** (The browser and the server tell what they know of the mods' state.) */
export const modsState = () => {
  const G = modsGlobal();
  return { version: G.version, parts: G.parts.map((p) => `${p.mod}:${p.part}`), disabled: Object.fromEntries(G.disabled), errors: G.errors, stale: [...G.stale.values()], safe: G.safe };
};
export { host as modHost };
