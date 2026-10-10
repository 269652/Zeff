import { handleMcp } from "@/mcp/http";

/** Streamable-HTTP MCP endpoint of one account: POST /api/mcp/<account id> (see src/mcp/http.ts). */
async function handler(req: Request, { params }: { params: Promise<{ account: string }> }): Promise<Response> {
  return handleMcp(req, (await params).account);
}

export { handler as GET, handler as POST, handler as DELETE };
