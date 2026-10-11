import { NextResponse } from "next/server";
import { ask, type Turn } from "@k/ask";
import { fail, unauthorized } from "@k/http";

/** A question ({ question, history? }) answered from the knowledge base, with its sources. */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { question?: string; history?: Turn[] };
    const question = String(b.question ?? "").trim();
    if (!question) return fail("No question.", 400);
    return NextResponse.json(await ask(question, Array.isArray(b.history) ? b.history : []));
  } catch (e) {
    return fail(e);
  }
}
