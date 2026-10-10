import { NextResponse } from "next/server";
import { keyOf } from "@k/compile";
import { entityDetail, entityIdByKey } from "@k/graph";
import { unauthorized } from "@k/http";

export const dynamic = "force-dynamic";

/**
 * One person in full (what they are, every relation, their pages) — by the entity's id, or by a
 * name (?name=…: its key, or one normalizing merged into it). Zeff's profile page shows it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = unauthorized(req);
  if (no) return no;
  const raw = decodeURIComponent((await params).id);
  const name = new URL(req.url).searchParams.get("name");
  const id = /^\d+$/.test(raw) ? Number(raw) : name ? entityIdByKey(keyOf(name)) : null;
  const e = id === null ? null : entityDetail(id);
  return e ? NextResponse.json(e) : NextResponse.json({ error: "not found" }, { status: 404 });
}
