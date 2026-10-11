import { isInstalled } from "@/plugins/state";
import { foreignRequest, refused } from "@/lib/request-guard";
import { MAX_ATTACHMENTS, saveAttachment } from "@/lib/work/attachments";

/**
 * POST /api/work/attach (multipart, field "files") — pictures and documents pasted or dropped into a
 * session's chat: kept for the worker to read. Answers { ok, files: [{ ref, name, size }] }. Only
 * from Zeff's own pages.
 */
export async function POST(req: Request) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    const files = (await req.formData()).getAll("files").filter((f): f is File => typeof f !== "string");
    if (!files.length) throw new Error("Keine Datei.");
    if (files.length > MAX_ATTACHMENTS) throw new Error(`Höchstens ${MAX_ATTACHMENTS} Dateien.`);
    const saved = [];
    for (const f of files) saved.push(saveAttachment(f.name || "datei", Buffer.from(await f.arrayBuffer())));
    return Response.json({ ok: true, files: saved });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
