import { promptText } from "@/lib/prompts";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { DEFAULT_ACCOUNT, accountById, withAccount } from "@/db/accounts";
import { RUN_HEADER, withCallerRun } from "@/mcp/caller";
import { INSTRUCTIONS, SERVER_INFO, registerZeffTools } from "@/mcp/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * The MCP endpoint, one per account: /api/mcp is the first account's (the one Zeff always had),
 * /api/mcp/<account> another's. An agent's connection never follows the account switched to in the
 * app — a coding agent on a work ticket books into work and searches work's knowledge, even while
 * you're in "Privat".
 *
 * Optional protection: set ZEFF_MCP_TOKEN and clients must send `Authorization: Bearer <token>`.
 */

type Handler = (req: Request) => Promise<Response>;
const state = globalThis as unknown as { __zeffMcp?: Map<string, { gen: number; tools?: unknown; h: Handler }> };
const handlers = (state.__zeffMcp ??= new Map());
// The tool list is made when a handler is: after a code change (dev hot reload evaluates this module again) the handlers are made again, else agents keep seeing the tools of the server's start.
const GENERATION = Date.now();

function handlerFor(id: string, name: string): Handler {
  // Made again too when the tools' code changed without this module being evaluated again (a hot reload of server.ts alone):
  // the registering function is another one then — agents saw the tools of an older load (todo_clock_* missing).
  const kept = handlers.get(id);
  let h = kept?.gen === GENERATION && kept.tools === registerZeffTools ? kept.h : undefined;
  if (!h) {
    h = createMcpHandler((server) => registerZeffTools(server), {
      serverInfo: SERVER_INFO,
      instructions: `${promptText("mcp", INSTRUCTIONS)}\n\nThis connection is Zeff's account "${name}": everything you book, read and search here is that account's.`,
      verboseLogs: process.env.ZEFF_MCP_VERBOSE === "1",
    });
    handlers.set(id, { gen: GENERATION, tools: registerZeffTools, h });
  }
  return h;
}

function tokenMatches(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A request to the MCP endpoint of an account (default: the first) — run inside that account. */
export async function handleMcp(req: Request, accountId: string = DEFAULT_ACCOUNT): Promise<Response> {
  // Agents and scripts — not another website open in your browser.
  const why = foreignRequest(req);
  if (why) return refused(why);
  const expected = process.env.ZEFF_MCP_TOKEN;
  if (expected && !tokenMatches(req.headers.get("authorization"), expected)) {
    return Response.json(
      { error: "unauthorized", message: "Send 'Authorization: Bearer <ZEFF_MCP_TOKEN>'." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="zeff"' } },
    );
  }
  const account = accountById(accountId);
  if (!account) return Response.json({ error: "not_found", message: `No Zeff account "${accountId}".` }, { status: 404 });
  return withAccount(account.id, () => withCallerRun(req.headers.get(RUN_HEADER), () => handlerFor(account.id, account.name)(req)));
}
