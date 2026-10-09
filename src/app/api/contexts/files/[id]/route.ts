import fs from "node:fs";
import { contextFileOnDisk } from "@/lib/contexts";

/** Shown in the browser (previews); anything else downloads. SVG can carry scripts, so it downloads. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain)$/i;

/** GET /api/contexts/files/:id — a context item's stored file. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = Number.isInteger(Number(id)) ? contextFileOnDisk(Number(id)) : undefined;
  if (!file || !fs.existsSync(file.absPath)) return new Response("Not found", { status: 404 });
  const inline = INLINE.test(file.mime);
  return new Response(new Uint8Array(fs.readFileSync(file.absPath)), {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
