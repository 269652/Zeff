import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";
import { slowJson } from "@/lib/slow-response";

/**
 * POST /api/workspace/widget-make { request, pageId?, current? } — a widget built (or changed) by the AI → { ok, widget, key, grant }
 * or { ok: false, error }. A route, not a Server Action: building takes up to a minute, and Server Actions run one after the
 * other — the page's saves would wait for it.
 */
export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { t } = await import("@/lib/i18n/server");
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("workspace")) return Response.json({ ok: false, error: t("The Workspace plugin is not installed.") }, { status: 404 });
  const v = ((await req.json().catch(() => null)) ?? {}) as { request?: unknown; pageId?: unknown; current?: { title?: string; html?: unknown; libs?: unknown; writes?: unknown; ai?: unknown } };
  // (Building takes longer than the proxy in front of an account's pages waits on a silent connection (30 s): slowJson keeps it
  // open with a space every few seconds — spaces before JSON are still JSON.)
  return slowJson(async () => {
    try {
      const { buildWidget } = await import("@/plugins/workspace/widget-make");
      const { wantsOf } = await import("@/lib/widgets/bridge");
      const c = v.current && typeof v.current.html === "string" && v.current.html ? v.current : null;
      const current = c
        ? { title: String(c.title ?? ""), html: c.html as string, libs: Array.isArray(c.libs) ? c.libs.map(String) : [], writes: wantsOf(c.writes).writes, ai: c.ai === true }
        : undefined;
      const pageId = Number.isInteger(v.pageId) && (v.pageId as number) > 0 ? (v.pageId as number) : null;
      return { ok: true, ...(await buildWidget(String(v.request ?? ""), pageId, current)) };
    } catch (e) {
      const { errorMessage } = await import("@/lib/errors");
      return { ok: false, error: errorMessage(e) };
    }
  });
}
