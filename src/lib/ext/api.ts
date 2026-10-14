import { callApi, type ApiResult } from "@/lib/plugins/api";
import type { ExtPlugin } from "./registry";

/**
 * The extension API, version 1 (docs/plugins/api.md is its reference): what a plugin's panel (through
 * the page that frames it) or program (with ZEFF_EXT_TOKEN) can ask of Zeff. The methods are not here
 * any more: every plugin brings its own (lib/plugins/api.ts is the registry, plugins/<id>/api.ts the
 * methods); this runs one as an external plugin, with the permissions you granted it.
 */
export { ApiError } from "@/lib/plugins/api-kit";
export type { ApiResult };

export const callExt = (plugin: ExtPlugin, method: string, params: unknown): Promise<ApiResult> =>
  callApi({ plugin: plugin.id, source: "external", permissions: plugin.permissions, ungranted: plugin.ungranted }, method, params);
