import { listAccounts, withAccount, currentAccountId } from "@/db/accounts";
import { getPlugin } from "@/lib/ext/registry";
import { callFunction, listFunctions } from "@/plugins/notebook/functions";
import { webhookSecretMatches } from "@/plugins/notebook/webhooks";
import { isInstalled } from "@/plugins/state";

export const dynamic = "force-dynamic";

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

/**
 * POST /api/ext/hook/<plugin>/<name>[?account=<id>] — a webhook: a plugin function that says `webhook: true` in its manifest, called by a
 * program outside Zeff. Authenticated by the plugin's webhook secret (Settings → Notebook; `Authorization: Bearer <secret>` or the header
 * `X-Zeff-Secret`) — not by the browser's origin, so another website's page, which does not know the secret, gets nothing. The body is
 * the arguments (a JSON object; any other body arrives as { body: "<text>" }). The function only does what it was granted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ plugin: string; name: string }> }) {
  const { plugin, name } = await params;
  const given = (/^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? req.headers.get("x-zeff-secret") ?? "").trim();
  const url = new URL(req.url);
  let account = currentAccountId();
  const asked = url.searchParams.get("account");
  if (asked) {
    if (!listAccounts().some((a) => a.id === asked)) return fail(400, "bad_request", `No account "${asked}".`);
    account = asked;
  }
  const text = (await req.text()).slice(0, 1_000_000);
  return withAccount(account, async () => {
    // One answer for every refusal below the secret: no hint whether the plugin or the function exists.
    if (!webhookSecretMatches(plugin, given)) return fail(401, "unauthorized", "Send the plugin's webhook secret (Settings → Notebook) as a Bearer header.");
    if (!isInstalled("notebook")) return fail(404, "not_installed", "The Notebook plugin is not installed (it runs the functions).");
    const p = getPlugin(plugin);
    if (!p || !p.enabled) return fail(403, "permission", `The plugin "${plugin}" isn't on in this account.`);
    const f = listFunctions().find((x) => x.plugin === plugin && x.name === name);
    if (!f?.webhook) return fail(404, "not_found", "There is no webhook of that name.");
    let args: Record<string, unknown> = {};
    if (text.trim()) {
      try {
        const v = JSON.parse(text) as unknown;
        args = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { body: text };
      } catch {
        args = { body: text };
      }
    }
    const r = await callFunction(plugin, name, args);
    return r.ok ? Response.json({ ok: true, result: r.value }) : fail(422, "function", r.error);
  });
}
