import assert from "node:assert/strict";
import test from "node:test";
import { workerMcpServers } from "@/lib/work/mcp";

test("a worker's Zeff MCP server is its own account's endpoint", () => {
  process.env.ZEFF_URL = "http://127.0.0.1:9333/";
  delete process.env.ZEFF_MCP_TOKEN;
  const c = workerMcpServers("privat", { "zeff-jira": { type: "stdio" } });
  assert.deepEqual(c.mcpServers.zeff, { type: "http", url: "http://127.0.0.1:9333/api/mcp/privat" });
  assert.ok("zeff-jira" in c.mcpServers);
  process.env.ZEFF_MCP_TOKEN = "s3";
  assert.deepEqual((workerMcpServers("default").mcpServers.zeff as { headers: unknown }).headers, { Authorization: "Bearer s3" });
  delete process.env.ZEFF_MCP_TOKEN;
});
