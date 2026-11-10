import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * POST /api/learn/courses { topic, goal, level, space? } — a new course, its research started in the background → { ok, id }
 * or { ok: false, error }. A route, not a Server Action: a page opened before Zeff (or the phone's server) was rebuilt
 * still reaches it — an old Server Action id would fail without a word.
 */
export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { t } = await import("@/lib/i18n/server");
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("learn")) return Response.json({ ok: false, error: t("The Learn plugin is not installed.") }, { status: 404 });
  const v = ((await req.json().catch(() => null)) ?? {}) as { topic?: unknown; goal?: unknown; level?: unknown; space?: unknown };
  try {
    const store = await import("@/plugins/learn/store");
    const { startResearch } = await import("@/plugins/learn/research");
    const id = store.createCourse({ topic: String(v.topic ?? ""), goal: String(v.goal ?? ""), level: String(v.level ?? ""), space: Number.isInteger(v.space) ? (v.space as number) : null });
    startResearch(id);
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/learn");
    if (Number.isInteger(v.space)) revalidatePath(`/workspace/${v.space as number}`);
    return Response.json({ ok: true, id });
  } catch (e) {
    const { errorMessage } = await import("@/lib/errors");
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 400 });
  }
}
