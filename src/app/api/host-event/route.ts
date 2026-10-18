import { emitLocal, type ChangeTopic } from "@/lib/events";
import { refreshMirror } from "@/lib/host/mirror";
import { authorized } from "@/lib/host/role";

export const dynamic = "force-dynamic";

const TOPICS: readonly string[] = ["work", "todos", "attention", "kanban", "workspace", "sync"];

/** The sync host says something changed: the open pages of this server refresh, and what the host is doing is read again. */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { topic?: unknown } | null;
  if (typeof body?.topic === "string" && TOPICS.includes(body.topic)) emitLocal(body.topic as ChangeTopic);
  void refreshMirror();
  return Response.json({ ok: true });
}
