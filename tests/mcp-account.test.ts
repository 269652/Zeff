import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

// Two accounts, the app switched to the second ("Privat") — as when you're in Privat while an agent works.
const dir = setupTempData();
fs.mkdirSync(path.join(dir, "accounts", "privat"), { recursive: true });
fs.writeFileSync(
  path.join(dir, "accounts.json"),
  JSON.stringify({
    active: "privat",
    installed: true,
    accounts: [
      { id: "default", name: "Standard", color: "indigo", createdAt: "1970-01-01T00:00:00.000Z" },
      { id: "privat", name: "Privat", color: "emerald", createdAt: "2026-10-09T00:00:00.000Z", chromePort: 9231, knowledgePort: 9556 },
    ],
  }),
);

const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const bearer = async (account: string) => `Bearer ${(await import("@/lib/account-tokens")).accountToken("mcp", account)}`;

/** One tool call through the HTTP endpoint (initialize first, as a client does) with a token, its text answer. */
async function callTool(account: string | undefined, token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const { handleMcp } = await import("@/mcp/http");
  const post = async (body: unknown) => {
    const url = `http://127.0.0.1/api/mcp${account ? `/${account}` : ""}`;
    const req = new Request(url, { method: "POST", headers: { ...H, authorization: await bearer(token) }, body: JSON.stringify(body) });
    const res = await handleMcp(req, account);
    const text = await res.text();
    // JSON, or an SSE stream whose data lines carry it.
    const data = text.trim().startsWith("{") ? text : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
    return { status: res.status, json: data ? JSON.parse(data) : null };
  };
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return (r.json.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
}

test("/api/mcp is the account whose token it shows, whichever account the app is in", async () => {
  const { withAccount, activeAccountId } = await import("@/db/accounts");
  const { createJob } = await import("@/lib/jobs");
  assert.equal(activeAccountId(), "privat");
  withAccount("default", () => createJob({ number: "100001", name: "Arbeitsjob" }));
  withAccount("privat", () => createJob({ number: "900009", name: "Privatjob" }));

  const work = await callTool(undefined, "default", "list_jobs", {});
  assert.match(work, /100001/);
  assert.doesNotMatch(work, /900009/);

  const priv = await callTool("privat", "privat", "list_jobs", {});
  assert.match(priv, /900009/);
  assert.doesNotMatch(priv, /100001/);
  assert.match(await callTool(undefined, "privat", "list_jobs", {}), /900009/, "the private token on /api/mcp: Privat's");
});

test("one account's token opens only that account: no token, another's, a made-up one — turned away", async () => {
  const { handleMcp } = await import("@/mcp/http");
  const { accountToken } = await import("@/lib/account-tokens");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const ask = (path: string, account: string | undefined, auth?: string) =>
    handleMcp(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { ...H, ...(auth ? { authorization: auth } : {}) }, body }), account);
  assert.notEqual(accountToken("mcp", "default"), accountToken("mcp", "privat"));
  assert.notEqual(accountToken("mcp", "privat"), accountToken("knowledge", "privat"), "the knowledge token isn't an MCP token");
  assert.equal((await ask("/api/mcp/default", "default")).status, 401);
  assert.equal((await ask("/api/mcp/default", "default", await bearer("privat"))).status, 401, "a private agent can't reach work");
  assert.equal((await ask("/api/mcp/privat", "privat", await bearer("default"))).status, 401);
  assert.equal((await ask("/api/mcp/default", "default", `Bearer ${accountToken("knowledge", "default")}`)).status, 401);
  assert.equal((await ask("/api/mcp", undefined)).status, 401);
  assert.equal((await ask("/api/mcp", undefined, "Bearer zm_madeup")).status, 401);
  assert.equal((await ask("/api/mcp/privat", "privat", await bearer("privat"))).status, 200);
});

test("an unknown account is refused, not served from another", async () => {
  const { handleMcp } = await import("@/mcp/http");
  const res = await handleMcp(new Request("http://127.0.0.1/api/mcp/nope", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), "nope");
  assert.equal(res.status, 404);
});

test("the knowledge export: only with the account's own knowledge token", async () => {
  const { GET } = await import("@/app/api/knowledge/export/route");
  const { accountToken } = await import("@/lib/account-tokens");
  const ask = (account: string, auth?: string) => GET(new Request(`http://127.0.0.1/api/knowledge/export?account=${account}&catalog=1`, { headers: auth ? { authorization: auth } : {} }));
  assert.equal((await ask("default")).status, 401);
  assert.equal((await ask("default", `Bearer ${accountToken("knowledge", "privat")}`)).status, 401, "Privat's knowledge server can't read work's");
  assert.equal((await ask("default", `Bearer ${accountToken("mcp", "default")}`)).status, 401, "an MCP token isn't a knowledge token");
  assert.notEqual((await ask("default", `Bearer ${accountToken("knowledge", "default")}`)).status, 401);
});
