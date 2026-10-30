import { connection } from "next/server";
import { SEARCH_SOURCES, sourcesOf, type SearchFilter } from "@/lib/search/shared";

/**
 * The one search's answer (the header's search, Ctrl/⌘+K, the Workspace's sidebar): `q` the text (">" first: the commands),
 * `in` the filter (all, workspace or one source). A route (not an action) so a search never waits behind a save.
 */
export async function GET(req: Request) {
  await connection();
  try {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").slice(0, 200);
    const f = sp.get("in") ?? "all";
    const filter: SearchFilter = f === "all" || f === "workspace" || (SEARCH_SOURCES as readonly string[]).includes(f) ? (f as SearchFilter) : "all";
    const { searchAll } = await import("@/lib/search");
    return Response.json({ groups: await searchAll(q, filter === "all" ? {} : { sources: sourcesOf(filter) }) });
  } catch {
    return Response.json({ groups: [] });
  }
}
