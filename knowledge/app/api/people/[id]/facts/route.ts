import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { addPersonFact } from "@k/person-facts";

export const dynamic = "force-dynamic";

/**
 * A fact Zeff confirmed about this person: { ref, text } — kept as a line of their page of your own
 * (the same ref replaces its line, an empty text removes it). → { page }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const no = unauthorized(req);
  if (no) return no;
  const id = Number((await params).id);
  try {
    const b = (await req.json()) as { ref?: unknown; text?: unknown };
    return NextResponse.json({ page: addPersonFact(id, { ref: String(b.ref ?? ""), text: String(b.text ?? "") }) });
  } catch (e) {
    return fail(e, e instanceof Error && e.message === "not found" ? 404 : 400);
  }
}
