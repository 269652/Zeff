import { NextResponse } from "next/server";
import { stopCompile } from "@k/compile";
import { unauthorized } from "@k/http";
import { stopSync } from "@k/ingest";

/** Stop reading and compiling: no further calls — those under way still finish. */
export function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  return NextResponse.json({ sync: stopSync(), compile: stopCompile() });
}
