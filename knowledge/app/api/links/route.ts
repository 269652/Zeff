import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { systemLinks } from "@k/search";

/** The addresses of the systems a piece of work is about: { text, ticket?, limit? } → links with their environment (test, prod …). No AI. */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { text?: string; ticket?: string; limit?: number };
    return NextResponse.json({ links: systemLinks(String(b.text ?? ""), b.ticket ? String(b.ticket) : null, Math.min(Number(b.limit) || 40, 80)) });
  } catch (e) {
    return fail(e, 400);
  }
}
