import { foreignRequest, refused } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/mods/report — the browser tells that a mod's hooks kept failing there and it switched the mod off (lib/mods/hook.ts):
 * written down, so it stays off (Mods page: why, and its errors). Zeff's own pages only.
 */
export async function POST(req: Request) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  if (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ ok: false }, { status: 403 });
  let body: { mod?: unknown; reason?: unknown; errors?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const { MOD_ID, modState, setModState } = await import("@/lib/mods/store");
  const id = String(body.mod ?? "");
  if (!MOD_ID.test(id)) return Response.json({ ok: false }, { status: 400 });
  const errors = (Array.isArray(body.errors) ? body.errors : []).slice(0, 5).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return { hook: String(o.hook ?? "").slice(0, 200), message: String(o.message ?? "").slice(0, 500), at: String(o.at ?? new Date().toISOString()).slice(0, 40), where: "browser" };
  });
  try {
    setModState(id, { enabled: false, disabledReason: `in the browser: ${String(body.reason ?? "its hooks kept failing").slice(0, 300)}`, errors: [...(modState(id).errors ?? []), ...errors].slice(-20) });
  } catch {
    return Response.json({ ok: false }, { status: 404 });
  }
  return Response.json({ ok: true });
}
