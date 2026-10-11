import fs from "node:fs";
import path from "node:path";
import { pluginsRoot } from "@/lib/ext/registry";

/** The documents of docs/plugins/ (the file's name, lower-cased). */
const FILES = ["README", "manifest", "api", "panels", "hooks", "security"];

/**
 * GET /ext/raw/<name> — a document of docs/plugins/ as plain Markdown, for tools and for AI workers
 * that write plugins: `curl http://127.0.0.1:9333/ext/raw/README`, then manifest, api, panels, hooks,
 * security. The README is prefixed with where this computer's plugins folder is.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = FILES.find((f) => f.toLowerCase() === name.replace(/\.md$/i, "").toLowerCase());
  if (!file) return new Response("Not found. Documents: " + FILES.join(", ").toLowerCase(), { status: 404 });
  let text: string;
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ process.cwd(), "docs", "plugins", `${file}.md`), "utf8");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const head = file === "README" ? `> The plugins folder on this computer: ${pluginsRoot()}\n> Plain-Markdown documents: /ext/raw/README, manifest, api, panels, hooks, security. JSON Schema: /ext/sdk/zeff-plugin.schema.json\n\n` : "";
  return new Response(head + text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" } });
}
