import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { INSTRUCTIONS, SERVER_INFO, registerZeffTools } from "@/mcp/server";

/**
 * Streamable-HTTP MCP endpoint: POST http://localhost:3000/api/mcp
 *
 * Optional protection: set ZEFF_MCP_TOKEN and clients must send
 * `Authorization: Bearer <token>`.
 */
const mcp = createMcpHandler((server) => registerZeffTools(server), {
  serverInfo: SERVER_INFO,
  instructions: INSTRUCTIONS,
  verboseLogs: process.env.ZEFF_MCP_VERBOSE === "1",
});

function tokenMatches(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function handler(req: Request): Promise<Response> {
  const expected = process.env.ZEFF_MCP_TOKEN;
  if (expected && !tokenMatches(req.headers.get("authorization"), expected)) {
    return Response.json(
      { error: "unauthorized", message: "Send 'Authorization: Bearer <ZEFF_MCP_TOKEN>'." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="zeff"' } },
    );
  }
  return mcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
