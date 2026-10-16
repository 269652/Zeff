import { connection } from "next/server";

/**
 * The command palette's record search: open todos (T-<id>, their text) and the Jira tickets they hang on, a handful.
 * A route (not an action) so a search never waits behind a save.
 */
export async function GET(req: Request) {
  await connection();
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100).toLowerCase();
    if (q.length < 2) return Response.json({ hits: [] });
    const { listTodos } = await import("@/lib/boards/store");
    const words = q.replace(/^t-/, "").split(/\s+/).filter(Boolean);
    const hits = listTodos({ status: "open" })
      .filter((todo) => {
        const hay = `${todo.ref} ${todo.ticket} ${todo.text}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((todo) => ({ id: `todo:${todo.id}`, label: `${todo.ref} ${todo.text}`.slice(0, 140), hint: todo.ticket || undefined, href: `/todos#todo-${todo.id}`, group: "Todos" }));
    // The Workspace's pages, by what they say and what they're called.
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("workspace")) {
      const { search } = await import("@/plugins/workspace/store");
      for (const h of search(q, 6)) hits.push({ id: `page:${h.id}`, label: `${h.icon ? `${h.icon} ` : ""}${h.title || "Untitled"}`.slice(0, 140), hint: h.path || undefined, href: `/workspace/${h.id}`, group: "Workspace" });
    }
    // What it can do in the Workspace (a new page, a pipeline refreshed): the ones the words fit.
    if (isInstalled("workspace")) {
      const { workspacePaletteItems } = await import("@/plugins/workspace/palette");
      const { filterPalette } = await import("@/lib/palette");
      hits.unshift(...(filterPalette(workspacePaletteItems(), q, 5) as typeof hits));
    }
    return Response.json({ hits });
  } catch {
    return Response.json({ hits: [] });
  }
}
