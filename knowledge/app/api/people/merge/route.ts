import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { mergePersonEntities } from "@k/person-facts";

export const dynamic = "force-dynamic";

/**
 * One person kept as several entities made one: { keep, drop: id | ids } — the dropped ones' pages,
 * relations and names go to `keep` (it keeps its name). → the kept entity in full.
 */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { keep?: unknown; drop?: unknown };
    const drop = (Array.isArray(b.drop) ? b.drop : [b.drop]).map(Number);
    return NextResponse.json(mergePersonEntities(Number(b.keep), drop));
  } catch (e) {
    return fail(e, e instanceof Error && e.message === "not found" ? 404 : 400);
  }
}
