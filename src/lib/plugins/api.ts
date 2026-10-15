import "@/plugins/contributions";
import { apiPoint } from "./api-point";
import { ApiError, holdsAll, type ApiCaller, type ApiMethod, type Params } from "./api-kit";
import "./core-api";

/**
 * The plugin API — one registry for every plugin, built-in or external. A plugin brings methods through
 * the `api.methods` extension point (its server.ts); they are there while it is installed. External
 * plugins reach them over HTTP with their token (/api/ext/v1/<method>) and need the method's permission;
 * built-in code calls them in-process with {@link callApi} and {@link builtinCaller}. Server only.
 */

export { apiPoint };

export type ApiResult = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string }; status: number };

/** Every method of the installed plugins, by name (the first to register a name keeps it). */
export function apiMethods(): Record<string, ApiMethod & { plugin: string }> {
  const out: Record<string, ApiMethod & { plugin: string }> = Object.create(null);
  for (const c of apiPoint.list())
    for (const [name, m] of Object.entries(c.impl.methods)) {
      if (name in out) console.error(`[api] "${name}" is brought by ${out[name].plugin} and by ${c.plugin}; keeping the first.`);
      else out[name] = { ...m, plugin: c.plugin };
    }
  return out;
}

/** Every permission a plugin may ask for, with what it allows: Zeff's own and those the installed plugins bring. */
export function knownPermissions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of apiPoint.list()) Object.assign(out, c.impl.permissions?.());
  return out;
}

/** In-process caller for a built-in plugin's own code: every permission, nothing held back. */
export const builtinCaller = (plugin: string): ApiCaller => ({ plugin, source: "builtin", permissions: holdsAll, ungranted: [] });

/** Run a method as `caller`: the method must exist (its plugin installed) and the permission be held; any failure is an error answer. */
export async function callApi(caller: ApiCaller, method: string, params: unknown): Promise<ApiResult> {
  try {
    const m = apiMethods()[method];
    if (!m) throw new ApiError("not_found", `No method "${method}".`);
    if (m.perm && !caller.permissions.has(m.perm)) {
      const held = caller.ungranted.includes(m.perm);
      throw new ApiError("permission", held ? `"${m.perm}" was added by an update — turn the plugin off and on again to grant it.` : `${method} needs the "${m.perm}" permission (declare it in zeff-plugin.json, then turn the plugin on again).`);
    }
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) throw new ApiError("bad_request", "params: a JSON object");
    return { ok: true, result: await m.run((params ?? {}) as Params, caller) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message }, status: e.status };
    return { ok: false, error: { code: "failed", message: e instanceof Error ? e.message : String(e) }, status: 500 };
  }
}

/** For built-in code: call a method of another plugin and get its value (the error is thrown). */
export async function callBuiltin<T = unknown>(plugin: string, method: string, params: Params = {}): Promise<T> {
  const r = await callApi(builtinCaller(plugin), method, params);
  if (!r.ok) throw new ApiError(r.error.code as ApiError["code"], r.error.message, r.status);
  return r.result as T;
}
