import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * The phone companion, through the launcher (launcher/lib/companion — the WebRTC end the phone talks to):
 *   GET   → { at, todos }: your open todos and the ones closed lately
 *   POST  { ops: [...] } → { results }: the phone's changes (ticks, flags, notes), each applied once
 * Not for other websites (the launcher, like a script, sends no Origin).
 */
export async function GET(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { companionSnapshot } = await import("@/lib/companion");
  return Response.json(await companionSnapshot());
}

export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  let body: { ops?: unknown };
  try {
    body = (await req.json()) as { ops?: unknown };
  } catch {
    return Response.json({ error: "Send JSON: { ops: [...] }." }, { status: 400 });
  }
  if (!Array.isArray(body.ops) || body.ops.length > 1000) return Response.json({ error: "ops: an array (at most 1000)." }, { status: 400 });
  const { applyCompanionOps, isCompanionOp } = await import("@/lib/companion");
  const ops = body.ops.filter(isCompanionOp);
  const results = await applyCompanionOps(ops);
  // One we can't read is answered too (skipped): the phone drops it instead of sending it forever.
  for (const o of body.ops) {
    const id = o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string" ? (o as { id: string }).id : null;
    if (id && !isCompanionOp(o)) results.push({ id, ok: true, skipped: "invalid" });
  }
  return Response.json({ results });
}
