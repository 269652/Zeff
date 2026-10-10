import { isInstalled } from "@/plugins/state";
import { getRun } from "@/lib/work/store";

/** GET /api/work/:id/prompt — exactly what a work run was told (the brief and its task), as text. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const { id } = await params;
  const run = Number.isInteger(Number(id)) ? getRun(Number(id)) : undefined;
  if (!run) return new Response("Not found", { status: 404 });
  return new Response(run.prompt, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
