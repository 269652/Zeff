import { NextResponse } from "next/server";
import { accountById, currentAccountId, withAccount } from "@/db/accounts";
import { bearerIs } from "@/lib/account-tokens";
import { knowledgeCatalog, knowledgeDocs } from "@/plugins/knowledge/export";
import { isInstalled } from "@/plugins/state";

export const dynamic = "force-dynamic";

/**
 * Zeff's synced context as documents, for the knowledge server's "Zeff" source (Knowledge plugin)
 * — of the account that knowledge server belongs to (?account=<id>; without: the one you're in);
 * ?only=keep: only the Google Keep notes (its Google Keep source). ?catalog=1: what can be picked (each source by its
 * space, each database of the Workspace); ?include=<id>,<id>: only those (none given: as before — every source, and the
 * databases switched into the knowledge).
 * Only with the account's own knowledge token ("Authorization: Bearer zk_…", data/knowledge-instances.json gives each knowledge
 * server its own): one account's token opens only that account's export.
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("account");
  if (id && !accountById(id)) return NextResponse.json({ error: `There is no account “${id}” in Zeff.` }, { status: 404 });
  if (!bearerIs(req.headers.get("authorization"), "knowledge", id ?? currentAccountId())) return NextResponse.json({ error: "unauthorized — the account's knowledge token is missing (restart the knowledge server: it reads it from data/knowledge-instances.json)" }, { status: 401 });
  // ?only=keep: just the Google Keep notes (the knowledge server's Google Keep source) — that needs Keep, not Knowledge.
  const only = url.searchParams.get("only") === "keep" ? "keep" : undefined;
  const run = () => {
    if (only && !isInstalled("keep")) return NextResponse.json({ error: "Google Keep is not installed in this Zeff account (Menu → Plugins)." }, { status: 404 });
    if (!only && !isInstalled("knowledge")) return NextResponse.json({ error: "Knowledge is not installed in this Zeff account (Menu → Plugins)." }, { status: 404 });
    if (url.searchParams.get("catalog") === "1") return NextResponse.json({ catalog: knowledgeCatalog() });
    const include = url.searchParams.get("include");
    return NextResponse.json(knowledgeDocs(url.origin, only, include === null ? undefined : include.split(",").map((x) => x.trim()).filter(Boolean)));
  };
  return id ? withAccount(id, run) : run();
}
