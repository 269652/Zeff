import { withAccount } from "@/db/accounts";
import { authorized } from "@/lib/host/role";
import { HOST_OPS } from "@/lib/host/ops";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * The sync host's one door (loopback; the web server's token): POST { op, args, account } runs one of HOST_OPS in
 * that account and answers { ok, result } or { ok: false, error }. Nobody without the shared secret gets in.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: { op?: unknown; args?: unknown; account?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const op = typeof body.op === "string" ? HOST_OPS[body.op] : undefined;
  if (!op) return Response.json({ ok: false, error: `unknown operation ${String(body.op)}` }, { status: 404 });
  const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  try {
    // The account the web server was in (accounts.json can change under a long run: this one is kept).
    const { reloadAccounts, accountById } = await import("@/db/accounts");
    reloadAccounts();
    const account = typeof body.account === "string" && accountById(body.account) ? body.account : null;
    const result = await (account ? withAccount(account, () => op(args)) : op(args));
    return Response.json({ ok: true, result: result ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
