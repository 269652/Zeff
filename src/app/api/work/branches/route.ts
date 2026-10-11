import { isInstalled } from "@/plugins/state";
import { foreignRequest, refused } from "@/lib/request-guard";
import { listBranches, repoRoot } from "@/lib/work/git";

/** GET /api/work/branches?path= - the branches of the git repo a folder is in (and where each is checked out), for the branch picker. */
export async function GET(req: Request) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  const folder = new URL(req.url).searchParams.get("path") ?? "";
  const root = repoRoot(folder);
  if (!root) return Response.json({ ok: false, error: `${folder || "No folder"} isn't in a git repo.` }, { status: 400 });
  return Response.json({ ok: true, root, ...listBranches(folder) });
}
