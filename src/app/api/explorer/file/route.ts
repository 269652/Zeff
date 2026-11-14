import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { foreignRequest, refused } from "@/lib/request-guard";
import { isInstalled } from "@/plugins/state";

/** Shown in the browser (the Explorer's viewer); anything else downloads. SVG and HTML can carry scripts, so they download. */
const INLINE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
  txt: "text/plain; charset=utf-8",
};

/**
 * GET /api/explorer/file?path=… — a file of this computer for the Explorer's viewer (pictures, PDFs, audio, video; Range requests so
 * a video can be wound), `&download=1` as a download. Only for Zeff's own pages, while the Explorer is installed.
 */
export async function GET(req: Request) {
  if (!isInstalled("explorer")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  const url = new URL(req.url);
  const raw = url.searchParams.get("path");
  if (!raw) return new Response("No path", { status: 400 });
  const { normPath } = await import("@/plugins/explorer/files");
  let p: string;
  let size: number;
  try {
    p = normPath(raw);
    const st = fs.statSync(/*turbopackIgnore: true*/ p);
    if (!st.isFile()) return new Response("Not a file", { status: 400 });
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const name = path.basename(p);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const download = url.searchParams.get("download") === "1";
  const type = !download && INLINE[ext] ? INLINE[ext] : "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ p, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ p)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
