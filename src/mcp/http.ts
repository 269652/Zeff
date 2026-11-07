import { noteRunContact } from "./run-contacts";
import { promptText } from "@/lib/prompts";
import { createMcpHandler } from "mcp-handler";
import { accountById, listAccounts, withAccount } from "@/db/accounts";
import { bearerIs } from "@/lib/account-tokens";
import { RUN_HEADER, withCallerRun } from "@/mcp/caller";
import { INSTRUCTIONS, SERVER_INFO, registerZeffTools } from "@/mcp/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * The MCP endpoint, one per account: /api/mcp/<account> — or /api/mcp, where the token says which account
 * (each account's token opens only that one). An agent's connection never follows the account switched to in the app — a coding agent on a work ticket books
 * into work and searches work's knowledge, even while you're in "Privat".
 *
 * Every request shows the account's own token (`Authorization: Bearer zm_…`, Menu → MCP shows it; Zeff's
 * workers get theirs): one account's token opens only that account — an agent on a private todo can't
 * read work's todos, nor the other way round.
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

const unauthorized = (message: string) =>
  Response.json({ error: "unauthorized", message }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="zeff"' } });

/** A request to the MCP endpoint of an account (none named: the one whose token it shows) — run inside that account. */
export async function handleMcp(req: Request, accountId?: string): Promise<Response> {
  // Agents and scripts — not another website open in your browser.
  const why = foreignRequest(req);
  if (why) return refused(why);
  const auth = req.headers.get("authorization");
  const account = accountId === undefined ? listAccounts().find((a) => bearerIs(auth, "mcp", a.id)) : accountById(accountId);
  if (accountId === undefined && !account) return unauthorized("Send 'Authorization: Bearer <token>' with the token of a Zeff account (Zeff → Menu → MCP, in that account).");
  if (!account) return Response.json({ error: "not_found", message: `No Zeff account "${accountId}".` }, { status: 404 });
  if (!bearerIs(auth, "mcp", account.id)) return unauthorized(`Send 'Authorization: Bearer <token>' with the token of Zeff's account "${account.name}" (Zeff → Menu → MCP, in that account).`);
  return withAccount(account.id, () => {
    // A work run's session reached Zeff (an agent that never does, did nothing: routine-agent.ts).
    const run = Number(req.headers.get(RUN_HEADER));
    if (Number.isInteger(run) && run > 0) {
      try {
        noteRunContact(run);
      } catch {
        // only the note is missing; the request goes on
      }
    }
    return withCallerRun(req.headers.get(RUN_HEADER), () => handlerFor(account.id, account.name)(req));
  });
}
