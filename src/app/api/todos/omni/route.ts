import { connection } from "next/server";

/**
 * The todo omnibar's search: what a typed text names — tickets, mails, messages, comments, notes, documents, people, the
 * todos' own words — each with the todos it belongs to. A route, not a server action: actions run one after the other
 * (a search would wait behind a refresh or a save), routes run alongside.
 */
export async function GET(req: Request) {
  await connection();
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
    const { listTodos } = await import("@/lib/boards/store");
    const { omniSearch } = await import("@/lib/boards/omnibar");
    const { isInstalled } = await import("@/plugins/state");
    const todos = listTodos({ status: "all" }).filter((todo) => todo.status !== "dismissed");
    const people = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople().map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })) : [];
    return Response.json({ hits: await omniSearch(q, todos, { people }) });
  } catch {
    return Response.json({ hits: [] });
  }
}
