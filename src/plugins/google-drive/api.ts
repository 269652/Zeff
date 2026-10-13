/**
 * The little of Google Drive's v3 REST API that Zeff needs: folders, listing, uploads (resumable,
 * in chunks — backups are large), downloads, exports of Google's own documents, deletes. Calls
 * refresh the token when Drive says 401 and wait out rate limits and hiccups. Server only.
 */
import fs from "node:fs";
import { sleep } from "@/lib/abort";
import { t } from "@/lib/i18n/server";
import { accessToken } from "./oauth";

// (Pointed elsewhere by the tests: a stand-in for Drive.)
const base = () => (process.env.ZEFF_GOOGLE_API_BASE || "https://www.googleapis.com").replace(/\/$/, "");
/** An upload chunk: a multiple of 256 KiB, as Drive asks. */
const chunkSize = () => {
  const n = Number(process.env.ZEFF_DRIVE_CHUNK);
  return n >= 262144 && n % 262144 === 0 ? n : 8 * 1048576;
};

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,md5Checksum,modifiedTime";

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; md5Checksum?: string; modifiedTime?: string };

/** Drive answered with an error (status and Google's own words). */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}


/** One call, with the token; 401 → a fresh token once; 429/5xx and network errors → tried again a few times. */
async function call(url: string, init: RequestInit & { retries?: number } = {}): Promise<Response> {
  const retries = init.retries ?? 4;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let failure: unknown = null;
    // (A sign-in Google refuses isn't a hiccup: it fails at once.)
    const token = await accessToken(refreshed);
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      res = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(120000) });
    } catch (e) {
      failure = e;
    }
    if (res) {
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        attempt--;
        continue;
      }
      // (308 is a resumable upload's "go on".)
      if (res.ok || res.status === 308 || (res.status < 500 && res.status !== 429 && res.status !== 403)) return res;
      // 403 is also "rate limit exceeded" — only that is waited out.
      const text = res.status === 403 ? await res.clone().text() : "";
      const limited = res.status === 429 || res.status >= 500 || /rateLimitExceeded|userRateLimitExceeded|backendError/.test(text);
      if (!limited || attempt >= retries) return res;
      const wait = Number(res.headers.get("retry-after")) * 1000 || Math.min(30000, 1000 * 2 ** attempt);
      await sleep(wait);
      continue;
    }
    if (attempt >= retries) throw failure instanceof Error ? failure : new Error(String(failure));
    await sleep(Math.min(15000, 1000 * 2 ** attempt));
  }
}

async function problem(res: Response): Promise<DriveError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const message = body.error?.message ?? res.statusText ?? String(res.status);
  if (res.status === 403 && body.error?.errors?.some((e) => e.reason === "accessNotConfigured")) {
    return new DriveError(t("The Google Drive API isn't switched on in your Google Cloud project — enable “Google Drive API” there."), 403);
  }
  return new DriveError(`Google Drive: ${message} (${res.status})`, res.status);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await problem(res);
  return (await res.json()) as T;
}

/** A value in a Drive query ('…' with ' and \ escaped). */
const q = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The folder of that name in `parent` (or the Drive root) — made when it isn't there. */
export async function ensureFolder(name: string, parent?: string): Promise<string> {
  const query = `mimeType=${q(FOLDER_MIME)} and name=${q(name)} and trashed=false and ${q(parent ?? "root")} in parents`;
  const found = await json<{ files: DriveFile[] }>(await call(`${base()}/drive/v3/files?${new URLSearchParams({ q: query, fields: "files(id,name)", spaces: "drive", pageSize: "10" })}`));
  if (found.files[0]) return found.files[0].id;
  const made = await json<DriveFile>(
    await call(`${base()}/drive/v3/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
    }),
  );
  return made.id;
}

/** Whether a folder is still there (not deleted, not in the bin) — its id can go stale. */
export async function folderExists(id: string): Promise<boolean> {
  const res = await call(`${base()}/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed,mimeType`);
  if (res.status === 404) return false;
  const f = await json<{ trashed?: boolean }>(res);
  return !f.trashed;
}

/** What's in a folder (files and folders; not what's in the bin). */
export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q: `${q(folderId)} in parents and trashed=false`, fields: `nextPageToken,files(${FIELDS})`, spaces: "drive", pageSize: "200", orderBy: "modifiedTime desc" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await json<{ files: DriveFile[]; nextPageToken?: string }>(await call(`${base()}/drive/v3/files?${params}`));
    out.push(...page.files);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** A file's bytes — "range" it isn't: documents are small (their size was checked). */
export async function download(id: string): Promise<Buffer> {
  const res = await call(`${base()}/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw await problem(res);
  return Buffer.from(await res.arrayBuffer());
}

/** A Google document/sheet/presentation as the Office file Zeff's Documents reads. */
export async function exportFile(id: string, mime: string): Promise<Buffer> {
  const res = await call(`${base()}/drive/v3/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: mime })}`);
  if (!res.ok) throw await problem(res);
  return Buffer.from(await res.arrayBuffer());
}

/** Removed (to the bin is Drive's way for others — this is gone for good, a file Zeff made). Already gone is fine. */
export async function deleteFile(id: string): Promise<void> {
  const res = await call(`${base()}/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.ok || res.status === 404) return;
  throw await problem(res);
}

/** A file up to a folder — a resumable upload, a chunk at a time (so a hiccup doesn't start a 300 MB backup over). */
export async function uploadFile(o: { name: string; folderId: string; file: string; mime?: string }): Promise<DriveFile> {
  const size = fs.statSync(o.file).size;
  const mime = o.mime || "application/octet-stream";
  const start = await call(`${base()}/upload/drive/v3/files?${new URLSearchParams({ uploadType: "resumable", fields: FIELDS })}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mime, "x-upload-content-length": String(size) },
    body: JSON.stringify({ name: o.name, parents: [o.folderId] }),
  });
  if (!start.ok) throw await problem(start);
  const session = start.headers.get("location");
  if (!session) throw new DriveError(t("Google Drive gave no upload address."), 502);

  const fd = fs.openSync(o.file, "r");
  try {
    let offset = 0;
    let failures = 0;
    for (;;) {
      const len = Math.min(chunkSize(), size - offset);
      const buf = Buffer.alloc(len);
      if (len) fs.readSync(fd, buf, 0, len, offset);
      let res: Response;
      try {
        res = await call(session, {
          method: "PUT",
          headers: { "content-length": String(len), "content-range": len ? `bytes ${offset}-${offset + len - 1}/${size}` : `bytes */${size}` },
          body: buf,
          retries: 0,
        });
      } catch (e) {
        if (++failures > 4) throw e;
        offset = await resumeFrom(session, size);
        continue;
      }
      if (res.ok) return (await res.json()) as DriveFile;
      if (res.status === 308) {
        offset = rangeEnd(res);
        failures = 0;
        continue;
      }
      if (res.status >= 500 || res.status === 429) {
        if (++failures > 4) throw await problem(res);
        await sleep(Math.min(15000, 1000 * 2 ** failures));
        offset = await resumeFrom(session, size);
        continue;
      }
      throw await problem(res);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** How far a 308 says Drive has the file: the byte after "Range: bytes=0-N" (none: nothing yet). */
function rangeEnd(res: Response): number {
  const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

/** Asks an interrupted upload how much Drive already has. */
async function resumeFrom(session: string, size: number): Promise<number> {
  const res = await call(session, { method: "PUT", headers: { "content-length": "0", "content-range": `bytes */${size}` }, retries: 2 });
  if (res.status === 308) return rangeEnd(res);
  if (res.ok) return size;
  throw await problem(res);
}
