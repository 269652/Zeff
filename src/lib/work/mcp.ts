import { extWorkerMcpServers } from "@/lib/ext/work";
import { accountToken } from "@/lib/account-tokens";

/**
 * The MCP servers a Claude worker gets for its run (--mcp-config). Zeff's own is the one of the
 * account the run belongs to (/api/mcp/<account>, with that account's token — and only that one: a
 * private worker can't reach work's endpoint). A server given on the
 * command line wins over the project's and the user's of the same name. External plugins' servers
 * ("ext-<plugin>-<name>", see src/lib/ext) come along; Zeff's own can't be replaced by them.
 */
export function workerMcpServers(account: string, extra: Record<string, unknown> = {}, runId?: number): { mcpServers: Record<string, unknown> } {
  const base = (process.env.ZEFF_URL || `http://127.0.0.1:${process.env.PORT || 9333}`).replace(/\/$/, "");
  // (The run's id rides along: start_todo in a session without a ticket then moves that very session under the todo's ticket.)
  const headers = { Authorization: `Bearer ${accountToken("mcp", account)}`, ...(runId ? { "X-Zeff-Run": String(runId) } : {}) };
  return {
    mcpServers: {
      ...extWorkerMcpServers(),
      zeff: { type: "http", url: `${base}/api/mcp/${encodeURIComponent(account)}`, headers },
      ...extra,
    },
  };
}
