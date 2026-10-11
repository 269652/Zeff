import { isInstalled } from "@/plugins/state";
import { getRun } from "@/lib/work/store";
import { commitSession, openSessionMr, pushSession, sessionDiff, sessionFiles } from "@/lib/work/session-git";
import { listProcs, startProc, stopProc } from "@/lib/work/session-procs";
import { foreignRequest, refused } from "@/lib/request-guard";
import { t } from "@/lib/i18n/server";

/**
 * A session's workspace — what Claude Code shows beside the conversation.
 *
 * GET ?what=diff — every file changed since it began · ?what=files&q= — files for @ · ?what=procs — its dev servers.
 * POST { do: "commit", message } / { do: "push" } / { do: "mr", title } / { do: "proc-start" | "proc-stop", name }.
 *
 * Only from Zeff's own pages (its diff is your code; its buttons push and start servers).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  const run = getRun(Number((await params).id));
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  try {
    switch (url.searchParams.get("what")) {
      case "diff":
        return Response.json(await sessionDiff(run), { headers: { "Cache-Control": "no-store" } });
      case "files":
        return Response.json({ files: await sessionFiles(run, url.searchParams.get("q") ?? "") });
      case "procs":
        return Response.json({ procs: listProcs(run) }, { headers: { "Cache-Control": "no-store" } });
      default:
        return Response.json({ error: "What?" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req) ?? (/^application\/json/i.test(req.headers.get("content-type") ?? "") ? null : "not JSON");
  if (why) return refused(why);
  const run = getRun(Number((await params).id));
  if (!run) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { do?: string; message?: string; title?: string; name?: string };
  try {
    switch (body.do) {
      case "commit":
        return Response.json({ ok: true, commit: await commitSession(run, String(body.message ?? "").slice(0, 4000)) });
      case "push":
        return Response.json({ ok: true, branch: await pushSession(run) });
      case "mr":
        return Response.json({ ok: true, ...(await openSessionMr(run, String(body.title ?? "").slice(0, 300))) });
      case "proc-start":
        return Response.json({ ok: true, proc: await startProc(run, String(body.name ?? "")) });
      case "proc-stop":
        stopProc(run, String(body.name ?? ""));
        return Response.json({ ok: true });
      default:
        throw new Error(t("Unknown action."));
    }
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
