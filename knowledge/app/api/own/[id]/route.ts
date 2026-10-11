import { NextResponse } from "next/server";
import { fail, unauthorized } from "@k/http";
import { getOwn, removeOwn, updateOwn } from "@k/own";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** One of your entries changed: { title?, text?, url? }. */
export async function PUT(req: Request, { params }: Ctx) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const id = decodeURIComponent((await params).id);
    const b = (await req.json()) as { title?: unknown; text?: unknown; url?: unknown };
    await updateOwn(id, { title: b.title === undefined ? undefined : String(b.title), text: b.text === undefined ? undefined : String(b.text), url: b.url === undefined ? undefined : String(b.url) });
    return NextResponse.json({ id, entry: getOwn(id) });
  } catch (e) {
    return fail(e, 400);
  }
}

/** One of your entries gone. */
export async function DELETE(req: Request, { params }: Ctx) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    removeOwn(decodeURIComponent((await params).id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}
