import { connection } from "next/server";

/**
 * Source health, read-only (for agents and scripts — the MCP tool `source_health` says the same): each sync step's state
 * (ok, failing, drift, stale, silent), why, when it last ran and when its newest item came. `?source=<key>` for one.
 */
export async function GET(req: Request) {
  await connection();
  const { sourceHealth, sourceHealthText } = await import("@/lib/sync/source-health");
  const { healthReason } = await import("@/lib/sync/source-health-shared");
  const { t } = await import("@/lib/i18n/server");
  const want = new URL(req.url).searchParams.get("source")?.toLowerCase();
  const all = await sourceHealth();
  const list = want ? all.filter((h) => h.key.toLowerCase() === want) : all;
  if (want && !list.length) return Response.json({ error: `No source "${want}".` }, { status: 404 });
  return Response.json({ sources: list.map((h) => ({ ...h, reason: h.state === "ok" ? null : healthReason(t, h) })), text: sourceHealthText(list) });
}
