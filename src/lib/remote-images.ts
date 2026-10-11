import { automationEnv } from "@/plugins/drivers";
import path from "node:path";
import { isRemoteImage, type FetchedImage } from "@/lib/contexts-shared";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

const MAX_BYTES = 20 * 1024 * 1024;
/** The picture types kept (shown inline, attached in Jira) — no SVG, which can carry scripts. */
const KEPT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };

/** A downloaded picture's file name: the last part of its address, with an extension that fits its type. */
export function imageFileName(url: string, mime: string): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    // an odd address: the fallback name below
  }
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(-100) || "image";
  const ext = KEPT[mime];
  return ext && !new RegExp(`\\.(${ext}${ext === "jpg" ? "|jpeg" : ""})$`, "i").test(base) ? `${base}.${ext}` : base;
}

/** A picture the way Zeff keeps it, or why not. */
function kept(url: string, mime: string, data: Buffer | string, size: number): FetchedImage {
  if (!KEPT[mime]) return { url, ok: false, error: t("isn't a picture Zeff keeps ({mime})", { mime }) };
  if (size > MAX_BYTES) return { url, ok: false, error: t("larger than {mb} MB", { mb: MAX_BYTES / 1024 / 1024 }) };
  return { url, ok: true, name: imageFileName(url, mime), mime, size, data: typeof data === "string" ? data : data.toString("base64") };
}

/** Straight from the web (public pictures). Null when that gives no picture — e.g. a sign-in redirect. */
async function fetchDirect(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { accept: "image/*" }, signal: AbortSignal.timeout(15000) });
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !mime.startsWith("image/")) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return kept(url, mime, "", MAX_BYTES + 1);
    const buf = Buffer.from(await res.arrayBuffer());
    return kept(url, mime, buf, buf.length);
  } catch {
    return null;
  }
}

/** Through the automation Chrome (scripts/images-mcp.mjs), with the sessions signed in there. */
async function fetchViaChrome(urls: string[]): Promise<FetchedImage[]> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "images-mcp.mjs");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "Picture download" },
    async (call) => resultToPayload(await call("fetch_images", { urls })),
    150000, // may start the automation Chrome first
  );
  const parsed = (typeof out === "string" ? JSON.parse(out) : out) as { images?: ({ url: string; ok: boolean; mime?: string; size?: number; data?: string; error?: string })[] };
  return (parsed.images ?? []).map((r) =>
    r.ok && r.mime && r.data ? kept(r.url, r.mime, r.data, r.size ?? 0) : { url: r.url, ok: false, error: r.error ?? t("couldn't be fetched") },
  );
}

/**
 * Download pictures that came as links (pasted from GitLab, Jira, a web page) — each straight
 * from the web, else through the automation Chrome for sites that need you signed in. Read-only.
 */
export async function fetchRemoteImages(urls: string[]): Promise<FetchedImage[]> {
  const list = [...new Set(urls)].filter(isRemoteImage).slice(0, 30);
  const direct = await Promise.all(list.map(fetchDirect));
  const rest = list.filter((_, i) => !direct[i]);
  const viaChrome = new Map<string, FetchedImage>();
  if (rest.length) {
    try {
      for (const r of await fetchViaChrome(rest)) viaChrome.set(r.url, r);
    } catch (e) {
      const why = errorMessage(e);
      for (const url of rest) viaChrome.set(url, { url, ok: false, error: why });
    }
  }
  return list.map((url, i) => direct[i] ?? viaChrome.get(url) ?? { url, ok: false, error: t("couldn't be fetched") });
}
