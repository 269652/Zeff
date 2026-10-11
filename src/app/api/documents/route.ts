import { foreignRequest, refused } from "@/lib/request-guard";
import { addDocument } from "@/plugins/documents/store";
import { startProcessing } from "@/plugins/documents/process";
import { isInstalled } from "@/plugins/state";

/**
 * POST /api/documents (multipart, field "files") — documents dropped in: kept, and read in the
 * background. Answers { ok, documents: [{ id, ref, name, status, fresh }] } — `fresh` false: that
 * content was there already. Only from Zeff's own pages (and agents / scripts).
 */
export async function POST(req: Request) {
  if (!isInstalled("documents")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    const files = (await req.formData()).getAll("files").filter((f): f is File => typeof f !== "string");
    if (!files.length) throw new Error("No file.");
    if (files.length > 50) throw new Error("At most 50 files at once.");
    const out = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        const { doc, fresh } = addDocument(f.name || "document", Buffer.from(await f.arrayBuffer()), f.type);
        out.push({ id: doc.id, ref: doc.ref, name: doc.name, status: doc.status, fresh });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (out.some((d) => d.fresh)) startProcessing();
    if (!out.length) throw new Error(errors.join(" "));
    return Response.json({ ok: true, documents: out, ...(errors.length ? { errors } : {}) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
