import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/** POST /api/learn/cards/<id>/review {grade: again|hard|good|easy} — a card reviewed: its next date, a point; the review todo follows. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("learn")) return Response.json({ error: "not installed" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { grade?: string } | null;
  const grade = (["again", "hard", "good", "easy"] as const).find((g) => g === body?.grade);
  if (!grade) return Response.json({ error: "grade: again, hard, good or easy" }, { status: 400 });
  try {
    const store = await import("@/plugins/learn/store");
    const { syncReviewTodos } = await import("@/plugins/learn/schedule");
    const r = store.reviewCard(Number((await params).id), grade);
    syncReviewTodos();
    return Response.json({ xp: r.xp, due: r.card.due });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
