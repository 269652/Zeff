import { foreignRequest, refused } from "@/lib/request-guard";
import { isInstalled } from "@/plugins/state";

/**
 * POST /api/capture (multipart: text, files) - a quick capture made a row of the Workspace's "Capture" database. Only from Zeff's own
 * pages (and scripts); at most 10 files.
 */
export async function POST(req: Request) {
  if (!isInstalled("workspace")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    const fd = await req.formData();
    const files = await Promise.all(fd.getAll("files").filter((f): f is File => typeof f !== "string").slice(0, 10).map(async (f) => ({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) })));
    const { capture } = await import("@/plugins/workspace/capture");
    const r = await capture(String(fd.get("text") ?? ""), files, String(fd.get("from") ?? "capture").slice(0, 40));
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
