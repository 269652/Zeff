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

/**
 * A method the AI may propose as an Auto-Aktion ("zeff-do"): what it is for, the fields the AI fills in (texts),
 * how those become the method's parameters — and how the button and the card read. The click runs the method.
 * A plugin offers a method by adding this to it: the AI's dictionary, the validation and the button follow.
 */
export type ApiOffer = {
  /** Its name ("Branch rule"). */
  label: string;
  /** For the AI: when to use it (German, like the rest of the dictionary). */
  when: string;
  /** The fields the AI fills in, each described (all texts). */
  fields: Record<string, string>;
  example: Record<string, string>;
  /** What the AI wrote → the method's parameters; null: incomplete or not meant (dropped). May look things up (a board by its name). */
  check: (raw: Record<string, string>) => Params | null;
  /** The button and the card, in the language of the account when it is proposed. */
  describe: (p: Params) => { title: string; body?: string };
  /**
   * What exists now that the AI must know to write the fields right (the current instructions, the boards and their
   * columns, what is written down about the topic): lines for the prompt about one todo. This is the retrieval — the AI
   * adjusts what is there instead of writing beside it. The same lines are given to agents over the MCP (zeff_actions).
   */
  context?: (q: { ticket: string; text: string }) => string[] | Promise<string[]>;
};

/** One method: `perm` the permission it needs (none: any caller), `summary` for the docs, `offer` to let the AI propose it. */
export type ApiMethod = { perm?: string; summary: string; offer?: ApiOffer; /** Safe to run from an automation step by itself: it works inside Zeff only (a row, a todo, a signal) and sends nothing out. */ automatic?: boolean; run: (p: Params, caller: ApiCaller) => unknown | Promise<unknown> };

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
