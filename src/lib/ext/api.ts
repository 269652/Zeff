import { currentAccount } from "@/db/accounts";
import { API_VERSION, type Permission } from "./manifest";
import type { ExtPlugin } from "./registry";
import { storageDelete, storageGet, storageKeys, storageSet } from "./storage";
import { runBrief } from "./work";

/**
 * The extension API, version 1 (docs/plugins/api.md is its reference): what a plugin's panel
 * (through the page that frames it) or program (with ZEFF_EXT_TOKEN) can ask of Zeff. Each method
 * takes a JSON object, answers a JSON value, and may need a permission the plugin was granted.
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

type Params = Record<string, unknown>;
type Method = { perm?: Permission; run: (p: Params, plugin: ExtPlugin) => unknown | Promise<unknown> };

const str = (p: Params, k: string, opts: { required?: boolean; max?: number } = {}): string => {
  const v = p[k];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new ApiError("bad_request", `${k}: required`);
    return "";
  }
  if (typeof v !== "string") throw new ApiError("bad_request", `${k}: must be a text`);
  if (v.length > (opts.max ?? 20000)) throw new ApiError("bad_request", `${k}: too long`);
  return v;
};
const int = (p: Params, k: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined => {
  const v = p[k];
  if (v === undefined || v === null) {
    if (opts.required) throw new ApiError("bad_request", `${k}: required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < (opts.min ?? 0) || v > (opts.max ?? 1e9)) throw new ApiError("bad_request", `${k}: must be a whole number`);
  return v;
};

/** A run as plugins see it. */
async function runInfo(id: number, full = false) {
  const { getRun, toRunView } = await import("@/lib/work/store");
  const raw = getRun(id);
  if (!raw) throw new ApiError("not_found", `No run ${id}.`);
  const r = toRunView(raw);
  return { ...runBrief(r), ...(full ? { result: r.result, repo: r.repo, cwd: r.cwd, base: r.base, sessionId: r.sessionId, turns: r.turns, gitSummary: r.gitSummary } : {}) };
}

const TICKET = /^[A-Z][A-Z0-9]+-\d+$/i;

/** Every method, by name. */
export const METHODS: Record<string, Method> = {
  hello: {
    run: (_p, plugin) => ({
      apiVersion: API_VERSION,
      plugin: { id: plugin.id, name: plugin.manifest.name, version: plugin.manifest.version },
      account: { id: currentAccount().id, name: currentAccount().name },
      permissions: [...plugin.permissions],
      ungranted: plugin.ungranted,
    }),
  },

  "storage.get": { run: (p, plugin) => storageGet(plugin.id, p.key) },
  "storage.set": { run: (p, plugin) => (storageSet(plugin.id, p.key, p.value), true) },
  "storage.delete": { run: (p, plugin) => (storageDelete(plugin.id, p.key), true) },
  "storage.keys": { run: (_p, plugin) => storageKeys(plugin.id) },

  "work.runs.list": {
    perm: "work.read",
    run: async (p) => {
      const { recentRuns } = await import("@/lib/work/store");
      const limit = int(p, "limit", { min: 1, max: 200 }) ?? 50;
      const status = str(p, "status", { max: 20 });
      const ticket = str(p, "ticket", { max: 40 }).toUpperCase();
      const todoId = int(p, "todoId");
      return recentRuns(200)
        .filter((r) => (!status || r.status === status) && (!ticket || r.ticket === ticket) && (todoId === undefined || r.todoId === todoId))
        .slice(0, limit)
        .map(runBrief);
    },
  },
  "work.runs.get": { perm: "work.read", run: (p) => runInfo(int(p, "id", { required: true, min: 1 })!, true) },
  "work.runs.log": {
    perm: "work.read",
    run: async (p) => {
      const id = int(p, "id", { required: true, min: 1 })!;
      const run = await runInfo(id);
      const { readLog } = await import("@/lib/work/log");
      const from = int(p, "from") ?? 0;
      const all = readLog(id).lines;
      return { status: run.status, lines: all.slice(from, from + 500), next: Math.min(all.length, from + 500) };
    },
  },
  "work.sessions.start": {
    perm: "work.write",
    run: async (p) => {
      const instruction = str(p, "instruction", { required: true });
      const ticket = str(p, "ticket", { max: 40 });
      if (ticket && !TICKET.test(ticket)) throw new ApiError("bad_request", "ticket: a ticket key like ABC-123");
      const { startSessionAction } = await import("@/plugins/work/server-actions");
      const r = await startSessionAction({ instruction, ticket, repoId: int(p, "repoId"), provider: str(p, "provider", { max: 20 }) || undefined });
      if (!r.ok) throw new ApiError("failed", r.error);
      return { runId: r.runId };
    },
  },
  "work.sessions.send": {
    perm: "work.write",
    run: async (p) => {
      const { startSessionAction } = await import("@/plugins/work/server-actions");
      const r = await startSessionAction({ instruction: str(p, "message", { required: true }), continueRunId: int(p, "runId", { required: true, min: 1 }) });
      if (!r.ok) throw new ApiError("failed", r.error);
      return { runId: r.runId };
    },
  },
  "work.runs.cancel": {
    perm: "work.write",
    run: async (p) => {
      const { cancelRun } = await import("@/lib/work/runner");
      try {
        cancelRun(int(p, "id", { required: true, min: 1 })!);
      } catch (e) {
        throw new ApiError("failed", e instanceof Error ? e.message : String(e));
      }
      return true;
    },
  },

  "todos.list": {
    perm: "todos.read",
    run: async (p) => {
      const { listTodos } = await import("@/lib/boards/store");
      const status = str(p, "status", { max: 12 }) || "open";
      if (!["open", "done", "dismissed", "all"].includes(status)) throw new ApiError("bad_request", 'status: "open", "done", "dismissed" or "all"');
      const limit = int(p, "limit", { min: 1, max: 500 }) ?? 200;
      return listTodos({ status: status as "open" | "done" | "dismissed" | "all", ticket: str(p, "ticket", { max: 40 }) || undefined })
        .slice(-limit)
        .map((t) => ({ id: t.id, ref: t.ref, ticket: t.ticket, text: t.text, kind: t.kind, owner: t.owner, status: t.status, due: t.due, parentId: t.parentId, source: t.source }));
    },
  },
  "todos.add": {
    perm: "todos.write",
    run: async (p) => {
      const ticket = str(p, "ticket", { max: 40 });
      if (ticket && !TICKET.test(ticket)) throw new ApiError("bad_request", "ticket: a ticket key like ABC-123");
      const { addSessionTodo } = await import("@/lib/boards/store");
      const t = addSessionTodo({ ticket, text: str(p, "text", { required: true, max: 500 }) });
      return { id: t.id, ref: t.ref };
    },
  },
};

export type ApiResult = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string }; status: number };

/** Run a method as a plugin: permission checked first; any failure becomes an error answer. */
export async function callExt(plugin: ExtPlugin, method: string, params: unknown): Promise<ApiResult> {
  try {
    const m = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;
    if (!m) throw new ApiError("not_found", `No method "${method}".`);
    if (m.perm && !plugin.permissions.has(m.perm)) {
      const held = plugin.ungranted.includes(m.perm);
      throw new ApiError("permission", held ? `"${m.perm}" was added by an update — turn the plugin off and on again to grant it.` : `${method} needs the "${m.perm}" permission (declare it in zeff-plugin.json, then turn the plugin on again).`);
    }
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) throw new ApiError("bad_request", "params: a JSON object");
    return { ok: true, result: await m.run((params ?? {}) as Params, plugin) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message }, status: e.status };
    return { ok: false, error: { code: "failed", message: e instanceof Error ? e.message : String(e) }, status: 500 };
  }
}
