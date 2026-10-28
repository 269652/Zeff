import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const req = (headers: Record<string, string>, url = "http://127.0.0.1:9333/api/x") => new Request(url, { method: "POST", headers });

/** Zeff's acting API routes: its own pages, agents and scripts — not another website open in your browser. */
test("another website's request is refused; Zeff's pages, agents and scripts pass", async () => {
  const { foreignRequest } = await import("@/lib/request-guard");
  // Agents, curl, scripts: no browser headers.
  assert.equal(foreignRequest(req({})), null);
  // Zeff's own pages, on each host it's served on.
  for (const o of ["http://127.0.0.1:9333", "http://localhost:9333", "https://zeff", "https://zeff.localhost", "https://knowledge.zeff"]) assert.equal(foreignRequest(req({ origin: o, "sec-fetch-site": "same-origin" })), null, o);
  // Another website: by the browser's mark, or by its origin.
  assert.ok(foreignRequest(req({ origin: "https://evil.example", "sec-fetch-site": "cross-site" })));
  assert.ok(foreignRequest(req({ origin: "https://evil.example" })));
  assert.ok(foreignRequest(req({ origin: "null" })));
  // Let in by name (Outlook for the calendar bookmarklet).
  assert.equal(foreignRequest(req({ origin: "https://outlook.office.com", "sec-fetch-site": "cross-site" }), ["https://outlook.office.com"]), null);
});

test("the MCP endpoint refuses a website's post, answers an agent's", async () => {
  const { handleMcp } = await import("@/mcp/http");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const { accountToken } = await import("@/lib/account-tokens");
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${accountToken("mcp", "default")}` };
  const site = await handleMcp(new Request("http://127.0.0.1/api/mcp", { method: "POST", headers: { ...h, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body }));
  assert.equal(site.status, 403);
  const agent = await handleMcp(new Request("http://127.0.0.1/api/mcp", { method: "POST", headers: h, body }));
  assert.equal(agent.status, 200);
});
