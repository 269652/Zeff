import { NextResponse } from "next/server";
import { accountById, withAccount } from "@/db/accounts";
import { knowledgeDocs } from "@/plugins/knowledge/export";
import { isInstalled } from "@/plugins/state";

export const dynamic = "force-dynamic";

/**
 * Zeff's synced context as documents, for the knowledge server's "Zeff" source (Knowledge plugin)
 * — of the account that knowledge server belongs to (?account=<id>; without: the one you're in);
 * ?only=keep: only the Google Keep notes (its Google Keep source).
 * With KNOWLEDGE_TOKEN set, only with "Authorization: Bearer <it>".
 */
export function GET(req: Request) {
  const token = process.env.KNOWLEDGE_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("account");
  if (id && !accountById(id)) return NextResponse.json({ error: `Das Konto „${id}“ gibt es in Zeff nicht.` }, { status: 404 });
  // ?only=keep: just the Google Keep notes (the knowledge server's Google Keep source) — that needs Keep, not Knowledge.
  const only = url.searchParams.get("only") === "keep" ? "keep" : undefined;
  const run = () => {
    if (only && !isInstalled("keep")) return NextResponse.json({ error: "Google Keep ist in diesem Zeff-Konto nicht installiert (Menü → Plugins)." }, { status: 404 });
    if (!only && !isInstalled("knowledge")) return NextResponse.json({ error: "Knowledge ist in diesem Zeff-Konto nicht installiert (Menü → Plugins)." }, { status: 404 });
    return NextResponse.json(knowledgeDocs(url.origin, only));
  };
  return id ? withAccount(id, run) : run();
}
