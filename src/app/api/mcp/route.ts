import { handleMcp } from "@/mcp/http";

/**
 * Streamable-HTTP MCP endpoint: POST http://127.0.0.1:9333/api/mcp — always the first account's,
 * whichever account the app is switched to (others: /api/mcp/<account id>; see src/mcp/http.ts).
 */
const handler = (req: Request) => handleMcp(req);

export { handler as GET, handler as POST, handler as DELETE };
