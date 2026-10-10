import { NextResponse } from "next/server";

/** Optional protection: with KNOWLEDGE_TOKEN set, callers send "Authorization: Bearer <it>" (Zeff does). */
export function unauthorized(req: Request): NextResponse | null {
  const expected = process.env.KNOWLEDGE_TOKEN;
  if (!expected) return null;
  return req.headers.get("authorization") === `Bearer ${expected}` ? null : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const fail = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
