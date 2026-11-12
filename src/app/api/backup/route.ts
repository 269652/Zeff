import fs from "node:fs";
import { Readable } from "node:stream";
import { foreignRequest, refused } from "@/lib/request-guard";
import { isInstalled } from "@/plugins/state";

/**
 * The header's Backup menu (a phone saves its backup from here):
 *   POST /api/backup              a fresh backup now → { ok, name, size, encrypted, message } (or { ok: false, error })
 *   GET  /api/backup?name=<file>  that backup, as a download (Content-Length set, so the page can show the progress)
 * Only from Zeff's own pages (and agents / scripts).
 */

export async function POST(req: Request) {
  if (!isInstalled("backup")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    const { runBackup, backupPath, listBackups } = await import("@/plugins/backup/backup");
    const r = await runBackup();
    if (!r.ok || !r.file) return Response.json({ ok: false, error: r.message }, { status: 500 });
    const name = r.file.split(/[\\/]/).pop()!;
    const size = fs.statSync(backupPath(name)).size;
    return Response.json({ ok: true, name, size, encrypted: listBackups().find((b) => b.name === name)?.encrypted ?? null, message: r.message });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isInstalled("backup")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req);
  if (why) return refused(why);
  try {
    const { backupPath } = await import("@/plugins/backup/backup");
    const file = backupPath(new URL(req.url).searchParams.get("name") ?? "");
    const size = fs.statSync(file).size;
    const name = file.split(/[\\/]/).pop()!;
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
