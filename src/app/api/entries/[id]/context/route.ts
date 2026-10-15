import { connection } from "next/server";

/**
 * The todos' context behind one entry of a table (what they came from, their notes and reports) — fetched when its toggle is
 * opened: the tables of a week or a month carry only how much there is. The account you're in; a GET only reads, and a request
 * from another site gets nothing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { foreignRequest, refused } = await import("@/lib/request-guard");
  const why = foreignRequest(req);
  if (why) return refused(why);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "bad id" }, { status: 400 });
  const { entryTodoContext } = await import("@/lib/entry-todo-context");
  return Response.json(entryTodoContext([id])[id] ?? null, { headers: { "cache-control": "no-store" } });
}
