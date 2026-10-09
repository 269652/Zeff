import { getTodo } from "@/lib/boards/store";

/** /t/37: T-37 on the Boards tab — among the open ones, or the done ones when it's settled. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(String(id).replace(/^t-?/i, ""));
  const t = Number.isInteger(n) && n > 0 ? getTodo(n) : undefined;
  const where = t && t.status !== "open" ? "/boards?todos=done" : "/boards";
  return Response.redirect(new URL(`${where}${t ? `#todo-${t.id}` : ""}`, request.url), 307);
}
