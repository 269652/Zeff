import { listAccounts, withAccount, currentAccountId } from "@/db/accounts";
import { callExt } from "@/lib/ext/api";
import { getPlugin } from "@/lib/ext/registry";
import { pluginOfToken } from "@/lib/ext/token";
import { foreignRequest, refused } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

/**
 * POST /api/ext/v1/<method> — the extension API (docs/plugins/api.md). Body: the method's
 * parameters (a JSON object). Answers { ok: true, result } or { ok: false, error: { code, message } }.
 *
 * Who is calling: a program a plugin started sends `Authorization: Bearer $ZEFF_EXT_TOKEN`; a panel's
 * calls come through Zeff's own page (the frame is sandboxed and can't send any), which names the
 * plugin in `x-zeff-ext-panel` — accepted only when the browser itself marks the request same-origin.
 * `x-zeff-account` picks the account (default: the one you're in; hooks get it as ZEFF_ACCOUNT).
 */
export async function POST(req: Request, { params }: { params: Promise<{ method: string }> }) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { method } = await params;

  const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  let pluginId: string | null = null;
  if (bearer) {
    pluginId = pluginOfToken(bearer.trim());
    if (!pluginId) return fail(401, "unauthorized", "That token isn't one Zeff made.");
  } else if (req.headers.get("sec-fetch-site") === "same-origin") {
    pluginId = req.headers.get("x-zeff-ext-panel");
  }
  if (!pluginId) return fail(401, "unauthorized", "Send the plugin's token (ZEFF_EXT_TOKEN) as a Bearer header.");

  let account = currentAccountId();
  const asked = req.headers.get("x-zeff-account");
  if (asked) {
    if (!listAccounts().some((a) => a.id === asked)) return fail(400, "bad_request", `No account "${asked}".`);
    account = asked;
  }

  let body: unknown;
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, "bad_request", "The body isn't JSON.");
    }
  }
  return withAccount(account, async () => {
    const plugin = getPlugin(pluginId!);
    if (!plugin || !plugin.enabled) return fail(403, "permission", `The plugin "${pluginId}" isn't on in this account.`);
    const r = await callExt(plugin, method, body);
    return r.ok ? Response.json({ ok: true, result: r.result }) : fail(r.status, r.error.code, r.error.message);
  });
}
