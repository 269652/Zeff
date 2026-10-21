import { NextResponse } from "next/server";
import { unauthorized } from "@k/http";
import { profileFacts } from "@k/profile";

export const dynamic = "force-dynamic";

/** What the knowledge knows about you as figures — your net income a month, your rent (?key= one of them), the newest month first. */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const key = new URL(req.url).searchParams.get("key") ?? undefined;
  return NextResponse.json({ facts: profileFacts(key) });
}
