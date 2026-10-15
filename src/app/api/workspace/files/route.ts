import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { filesDir } from "@/plugins/workspace/files";
import { isInstalled } from "@/plugins/state";

const MAX = 15 * 1024 * 1024;

/** The kind of picture a file is, by its first bytes (not by what the client calls it). */
function imageType(b: Buffer): { ext: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return { ext: "png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg" };
  if (b.length > 6 && b.toString("latin1", 0, 3) === "GIF") return { ext: "gif" };
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { ext: "webp" };
  if (b.length > 12 && b.toString("latin1", 4, 8) === "ftyp" && /avif|avis/.test(b.toString("latin1", 8, 16))) return { ext: "avif" };
  return null;
}

/** POST /api/workspace/files — a picture for a page (multipart, field "file"): kept by the hash of its bytes; the answer has its URL. */
export async function POST(req: Request) {
  if (!isInstalled("workspace")) return Response.json({ error: "Plugin not installed" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "Too large (15 MB at most)" }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return Response.json({ error: "Only pictures (PNG, JPEG, GIF, WebP, AVIF)" }, { status: 415 });
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${type.ext}`;
  const target = path.join(filesDir(), name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
  return Response.json({ url: `/api/workspace/files/${name}`, name: file.name.slice(0, 200) });
}
