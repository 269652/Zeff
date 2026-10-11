import { NextResponse } from "next/server";
import { db } from "@k/db";
import { unauthorized } from "@k/http";

export const dynamic = "force-dynamic";

/**
 * Pages by their ids (?ids=a,b — at most 50): whether each is compiled in its current version, and
 * its abstract (summary) and concepts — Zeff's Documents shows them in its hover cards.
 */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return NextResponse.json({ pages: [] });
  const rows = db()
    .prepare(`select id, title, summary, concepts, compiled_version = version as compiled from pages where id in (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: string; title: string; summary: string | null; concepts: string; compiled: number | null }[];
  return NextResponse.json({ pages: rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary ?? "", concepts: r.concepts, compiled: !!r.compiled })) });
}
