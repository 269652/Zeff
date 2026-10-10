import { NextResponse } from "next/server";
import { unauthorized } from "@k/http";
import { entity } from "@k/search";

export const dynamic = "force-dynamic";

/** An entity: what it is, its relations, its pages. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = unauthorized(req);
  if (no) return no;
  const e = entity(Number((await params).id));
  return e ? NextResponse.json(e) : NextResponse.json({ error: "not found" }, { status: 404 });
}
