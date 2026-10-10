import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { addOwn, getOwn, listOwn } from "@k/own";

export const dynamic = "force-dynamic";

/** Your own knowledge: the latest entries. */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 500);
  return NextResponse.json({ entries: listOwn(limit) });
}

/** Keep something: { title?, text?, url? } — a text, or a link (the page behind it read). Compiled right after. → { id, entry }. */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as { title?: unknown; text?: unknown; url?: unknown };
    const id = await addOwn({ title: b.title === undefined ? undefined : String(b.title), text: b.text === undefined ? undefined : String(b.text), url: b.url === undefined ? undefined : String(b.url) });
    return NextResponse.json({ id, entry: getOwn(id) });
  } catch (e) {
    return fail(e, 400);
  }
}
