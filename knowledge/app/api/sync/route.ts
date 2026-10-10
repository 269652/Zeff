import { NextResponse } from "next/server";
import { compilePages } from "@k/compile";
import { syncPages } from "@k/ingest";
import { unauthorized } from "@k/http";

/** Read Confluence now — and (?compile=1) compile what's new right after. In the background; /api/status tells. */
export function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const compile = new URL(req.url).searchParams.get("compile") === "1";
  void syncPages().then(async (r) => {
    if (compile && r.ok) await compilePages();
  });
  return NextResponse.json({ started: true, compile });
}
