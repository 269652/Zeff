import { listAccounts, withAccount, currentAccountId } from "@/db/accounts";
import { getPlugin } from "@/lib/ext/registry";
import { pluginOfToken } from "@/lib/ext/token";
import { foreignRequest, refused } from "@/lib/request-guard";
import { callFunction } from "@/plugins/notebook/functions";
import { isInstalled } from "@/plugins/state";

export const dynamic = "force-dynamic";

const fail = (status: number, code: string, message: string, log = "") => Response.json({ ok: false, error: { code, message }, ...(log ? { log } : {}) }, { status });

/**
 * POST /api/ext/fn/<plugin>/<name> — a server function a plugin brings (manifest contributes.functions). Body: its arguments (a JSON
 * object). Answers { ok: true, result, log } or { ok: false, error: { code, message } }. Who may call: the plugin's own programs
 * (`Authorization: Bearer $ZEFF_EXT_TOKEN`) and Zeff's own pages (same origin). The function reads or changes Zeff only through what
 * it was granted in Settings → Notebook; running code must be switched on there.
 */
export async function POST(req: Request, { params }: { params: Promise<{ plugin: string; name: string }> }) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { plugin, name } = await params;

  const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    if (pluginOfToken(bearer.trim()) !== plugin) return fail(401, "unauthorized", "That token is not this plugin's.");
  } else if (req.headers.get("sec-fetch-site") !== "same-origin") {
    return fail(401, "unauthorized", "Send the plugin's token (ZEFF_EXT_TOKEN) as a Bearer header, or call from a page of Zeff.");
  }

  let account = currentAccountId();
  const asked = req.headers.get("x-zeff-account");
  if (asked) {
    if (!listAccounts().some((a) => a.id === asked)) return fail(400, "bad_request", `No account "${asked}".`);
    account = asked;
  }
  let args: Record<string, unknown> = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return fail(400, "bad_request", "The body is a JSON object (the arguments).");
      args = v as Record<string, unknown>;
    } catch {
      return fail(400, "bad_request", "The body isn't JSON.");
    }
  }
  return withAccount(account, async () => {
    if (!isInstalled("notebook")) return fail(404, "not_installed", "The Notebook plugin is not installed (it runs the functions).");
    const p = getPlugin(plugin);
    if (!p || !p.enabled) return fail(403, "permission", `The plugin "${plugin}" isn't on in this account.`);
    const r = await callFunction(plugin, name, args);
    return r.ok ? Response.json({ ok: true, result: r.value, log: r.log }) : fail(422, "function", r.error, r.log);
  });
}
