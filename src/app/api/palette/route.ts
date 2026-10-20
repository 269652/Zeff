import { connection } from "next/server";
import type { PaletteItem } from "@/lib/palette";

/**
 * The command palette's record search: open todos (T-<id>, their text) and the Jira tickets they hang on, a handful;
 * people by what is known of them; the Workspace's pages.
 * A route (not an action) so a search never waits behind a save.
 */
export async function GET(req: Request) {
  await connection();
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100).toLowerCase();
    if (q.length < 2) return Response.json({ hits: [] });
    const { listTodos } = await import("@/lib/boards/store");
    const words = q.replace(/^t-/, "").split(/\s+/).filter(Boolean);
    const hits: PaletteItem[] = listTodos({ status: "open" })
      .filter((todo) => {
        const hay = `${todo.ref} ${todo.ticket} ${todo.text}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((todo) => ({ id: `todo:${todo.id}`, label: `${todo.ref} ${todo.text}`.slice(0, 140), hint: todo.ticket || undefined, href: `/todos#todo-${todo.id}`, group: "Todos" }));
    const { isInstalled } = await import("@/plugins/state");
    // People, by what Zeff learned about them (their claims and details: "IBAN Nathanael", "Luisenstraße").
    if (isInstalled("people")) hits.push(...(await (await import("@/plugins/people/search")).peoplePaletteItems(q)));
    // The Workspace's pages, by what they say and what they're called.
    if (isInstalled("workspace")) {
      const { search, getPage, getDatabase } = await import("@/plugins/workspace/store");
      // "in:news quantum" looks only in the databases (or pages under a path) whose name has "news" in it; hits stand in groups by database.
      const scope = /(?:^|\s)in:(\S+)/i.exec(q);
      const words = scope ? q.replace(scope[0], " ").trim() : q;
      const want = scope?.[1].toLowerCase();
      if (words.length >= 2) {
        const groups = new Map<string, typeof hits>();
        const total = new Map<string, number>();
        for (const h of search(words, 80)) {
          const dbId = getPage(h.id)?.dbId ?? null;
          const name = dbId ? (getDatabase(dbId)?.page.title || "Untitled") : "Pages";
          if (want && !`${name} ${h.path}`.toLowerCase().includes(want)) continue;
          total.set(name, (total.get(name) ?? 0) + 1);
          const list = groups.get(name) ?? [];
          if (list.length < (want ? 12 : 4)) list.push({ id: `page:${h.id}`, label: `${h.icon ? `${h.icon} ` : ""}${h.title || "Untitled"}`.slice(0, 140), hint: (dbId ? "" : h.path) || undefined, href: `/workspace/${h.id}`, group: name });
          groups.set(name, list);
        }
        // The groups with the most hits first, each named with how many there are.
        for (const [name, list] of [...groups.entries()].sort((a, b) => (total.get(b[0]) ?? 0) - (total.get(a[0]) ?? 0)).slice(0, want ? 3 : 6)) {
          for (const x of list) hits.push({ ...x, group: `${name} (${total.get(name)})` });
        }
      }
    }
    // What it can do in the Workspace (a new page, a pipeline refreshed): the ones the words fit.
    if (isInstalled("workspace")) {
      const { workspacePaletteItems } = await import("@/plugins/workspace/palette");
      const { filterPalette } = await import("@/lib/palette");
      hits.unshift(...filterPalette(workspacePaletteItems(), q, 5));
    }
    return Response.json({ hits });
  } catch {
    return Response.json({ hits: [] });
  }
}
