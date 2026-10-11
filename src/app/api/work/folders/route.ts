import { isInstalled } from "@/plugins/state";
import { foreignRequest, refused } from "@/lib/request-guard";
import { listFolder } from "@/lib/work/folders";

/** GET /api/work/folders?path= - the sub-folders of a folder, for the session's repo picker (your own computer's). Only from Zeff's own pages. */
export async function GET(req: Request) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    return Response.json({ ok: true, ...listFolder(new URL(req.url).searchParams.get("path")) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
