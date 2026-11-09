import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * Zeff on the go: the phone's or tablet's offline copy (src/lib/replica), through the launcher's WebRTC tunnel.
 *   GET                       → { at, manifest, conflicts }: every entity's key and version, the conflicts kept
 *   POST { want: [keys] }     → { entities }: those entities (at most 2000 per call)
 *   POST { ops: [...] }       → { results, ids, conflicts }: the phone's queued edits, in order, each once
 * Each account under its route (/<slug>/api/companion/replica). An account the lock guards answers 423.
 */
export async function GET(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { companionLocked } = await import("@/lib/companion");
  if (await companionLocked()) return Response.json({ error: "locked" }, { status: 423 });
  const { replicaManifest, replicaConflicts } = await import("@/lib/replica/server");
  return Response.json({ at: new Date().toISOString(), manifest: replicaManifest(), conflicts: replicaConflicts().slice(-50) });
}

export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  let body: { want?: unknown; ops?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Send JSON: { want: [...] } or { ops: [...] }." }, { status: 400 });
  }
  const { companionLocked } = await import("@/lib/companion");
  if (await companionLocked()) return Response.json({ error: "locked" }, { status: 423 });
  const server = await import("@/lib/replica/server");
  if (Array.isArray(body.want)) {
    if (body.want.length > 2000) return Response.json({ error: "want: at most 2000 keys per call." }, { status: 400 });
    return Response.json({ entities: server.replicaEntities(body.want.filter((k): k is string => typeof k === "string")) });
  }
  if (Array.isArray(body.ops)) {
    if (body.ops.length > 1000) return Response.json({ error: "ops: at most 1000 per call." }, { status: 400 });
    const { isReplicaOp } = await import("@/lib/replica/shared");
    const answer = await server.applyReplicaOps(body.ops.filter(isReplicaOp));
    // One we can't read is answered too (skipped): the phone drops it instead of sending it forever.
    for (const o of body.ops) {
      const id = o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string" ? (o as { id: string }).id : null;
      if (id && !isReplicaOp(o)) answer.results.push({ id, ok: true, skipped: "invalid" });
    }
    return Response.json(answer);
  }
  return Response.json({ error: "Send { want: [...] } or { ops: [...] }." }, { status: 400 });
}
