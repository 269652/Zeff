import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { related } from "@k/search";

/** What's relevant to a piece of work: { text, ticket?, limit? } → pages and entities (no AI — quick). */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { text?: string; ticket?: string; limit?: number };
    return NextResponse.json(related(String(b.text ?? ""), b.ticket ? String(b.ticket) : null, Math.min(Number(b.limit) || 5, 15)));
  } catch (e) {
    return fail(e, 400);
  }
}
