/**
 * The plugin API's building blocks — shared by the plugins that bring methods (their `api.ts`) and
 * by lib/plugins/api.ts that serves them. Client-safe (no database).
 */

export class ApiError extends Error {
  constructor(
    readonly code: "bad_request" | "permission" | "not_found" | "failed",
    message: string,
    readonly status = code === "permission" ? 403 : code === "not_found" ? 404 : 400,
  ) {
    super(message);
  }
}

export type Params = Record<string, unknown>;

/** Who calls: a built-in plugin's code (all it may do is up to the plugin) or an external plugin (what you granted it). */
export type ApiCaller = {
  plugin: string;
  source: "builtin" | "external";
  /** What the caller holds; a built-in caller holds everything ({@link holdsAll}). */
  permissions: { has(p: string): boolean; [Symbol.iterator](): Iterator<string> };
  /** Asked for by its manifest since you granted: held back until you turn it off and on. */
  ungranted: readonly string[];
};

/** One method: `perm` the permission it needs (none: any caller), `summary` for the docs. */
export type ApiMethod = { perm?: string; summary: string; run: (p: Params, caller: ApiCaller) => unknown | Promise<unknown> };

/** An event a hook can listen to: `topic` ties it to the app's change bus (lib/events.ts) — fired, at most every half second, when that topic changes. */
export type ApiEvent = { description: string; topic?: string };

/** What a plugin brings to the API: its methods (names "<area>.<what>"), the permissions they use, in words, and the events hooks can listen to. */
export type ApiContribution = {
  methods: Record<string, ApiMethod>;
  /** Event name ("kanban.changed") → what it is. */
  events?: Record<string, ApiEvent>;
  /** Permission id → what it allows, translated when asked (a function: the language is the caller's). */
  permissions?: () => Record<string, string>;
};

/** The permissions of a built-in caller: all of them. */
export const holdsAll = { has: () => true, *[Symbol.iterator]() {} };

export const str = (p: Params, k: string, opts: { required?: boolean; max?: number } = {}): string => {
  const v = p[k];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ApiError("bad_request", `${k}: required`);
    return "";
  }
  if (typeof v !== "string") throw new ApiError("bad_request", `${k}: must be a text`);
  if (v.length > (opts.max ?? 20000)) throw new ApiError("bad_request", `${k}: too long`);
  return v;
};

export const int = (p: Params, k: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined => {
  const v = p[k];
  if (v === undefined || v === null) {
    if (opts.required) throw new ApiError("bad_request", `${k}: required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < (opts.min ?? 0) || v > (opts.max ?? 1e9)) throw new ApiError("bad_request", `${k}: must be a whole number`);
  return v;
};

export const bool = (p: Params, k: string): boolean | undefined => {
  const v = p[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new ApiError("bad_request", `${k}: must be true or false`);
  return v;
};

export const TICKET = /^[A-Z][A-Z0-9]+-\d+$/i;
