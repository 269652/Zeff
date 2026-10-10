import { NextResponse } from "next/server";
import { unauthorized } from "@k/http";
import { normalizeEntities, normalizeProgress, normalizeRunning, pendingProposals } from "@k/normalize";

export const dynamic = "force-dynamic";

/** Normalizing: whether it runs, how far, the proposals waiting. */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  return NextResponse.json({ running: normalizeRunning(), progress: normalizeProgress(), proposals: pendingProposals() });
}

/** Normalize the entities now — in the background; ?apply=1 merges what the AI finds at once (else: proposals to review). */
export function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  const apply = new URL(req.url).searchParams.get("apply") === "1";
  void normalizeEntities({ apply });
  return NextResponse.json({ started: true, apply });
}
