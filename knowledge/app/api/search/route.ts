import { NextResponse } from "next/server";
import { unauthorized } from "@k/http";
import { searchEntities, searchPages } from "@k/search";

export const dynamic = "force-dynamic";

/** Pages and entities for a search (?q=…&limit=…). */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const limit = Math.min(Number(u.searchParams.get("limit")) || 8, 30);
  return NextResponse.json({ pages: searchPages(q, limit), entities: searchEntities(q, 6) });
}
