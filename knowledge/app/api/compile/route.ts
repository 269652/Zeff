import { NextResponse } from "next/server";
import { compilePages } from "@k/compile";
import { unauthorized } from "@k/http";

/** Compile the new and changed pages (Copilot) — in the background; /api/status tells. */
export function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const max = Number(new URL(req.url).searchParams.get("batches")) || undefined;
  void compilePages(max);
  return NextResponse.json({ started: true });
}
