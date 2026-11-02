import { prefixedUrl } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";
import { getTodo } from "@/lib/todos/store";
import { mergedIntoChain } from "@/lib/todos/merge";

/** /t/37: T-37 on the Todos tab — among the open ones, or the done ones when it's settled. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isInstalled("todos")) return Response.redirect(prefixedUrl("/plugins", request.url), 307);
  const { id } = await ctx.params;
  const n = Number(String(id).replace(/^t-?/i, ""));
  // A duplicate that was merged leads to the todo that kept its id.
  const t = Number.isInteger(n) && n > 0 ? getTodo(mergedIntoChain(n)) : undefined;
  const where = t && t.status !== "open" ? "/todos?todos=done" : "/todos";
  return Response.redirect(prefixedUrl(`${where}${t ? `#todo-${t.id}` : ""}`, request.url), 307);
}
