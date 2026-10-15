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
    return Response.json({ hits });
  } catch {
    return Response.json({ hits: [] });
  }
}
