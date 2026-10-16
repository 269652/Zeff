import fs from "node:fs";
import { documentFile } from "@/plugins/documents/store";
import { isInstalled } from "@/plugins/state";

/** Shown in the browser (previews); anything else downloads. SVG and HTML can carry scripts, so they download. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+)$/i;

/** GET /api/documents/:id/file — a document's stored file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("documents")) return new Response("Plugin not installed", { status: 404 });
  const { id } = await params;
  const file = Number.isInteger(Number(id)) ? documentFile(Number(id)) : null;
  if (!file) return new Response("Not found", { status: 404 });
  const inline = INLINE.test(file.mime);
  // Opening the file (?open=1 - a link you click, not a thumbnail on a page) is reading the document: it is seen (the Workspace's document inbox follows).
  if (new URL(req.url).searchParams.get("open") === "1") (await import("@/plugins/documents/seen")).markSeen([Number(id)]);
  return new Response(new Uint8Array(fs.readFileSync(file.path)), {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
