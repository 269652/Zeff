import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { repoSources } from "@k/search";

/** What the knowledge holds about a project: { terms, limit? } → pages with their abstract and address lines (for a summary). No AI. */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { terms?: unknown; limit?: number };
    const terms = (Array.isArray(b.terms) ? b.terms : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
    return NextResponse.json({ pages: repoSources(terms, Math.min(Number(b.limit) || 14, 30)) });
  } catch (e) {
    return fail(e, 400);
  }
}
