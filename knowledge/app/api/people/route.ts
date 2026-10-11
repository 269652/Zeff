import { NextResponse } from "next/server";
import { persons } from "@k/graph";
import { unauthorized } from "@k/http";

export const dynamic = "force-dynamic";

/** Every person the knowledge knows, the most named first — Zeff's people profiles suggest them. */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  return NextResponse.json({ persons: persons() });
}
