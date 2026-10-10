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

/** One tool call through the HTTP endpoint (initialize first, as a client does), its text answer. */
async function callTool(account: string | undefined, name: string, args: Record<string, unknown>): Promise<string> {
  const { handleMcp } = await import("@/mcp/http");
  const post = async (body: unknown) => {
    const url = `http://127.0.0.1/api/mcp${account ? `/${account}` : ""}`;
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
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

test("/api/mcp is the first account's, whichever account the app is in", async () => {
  const { withAccount, activeAccountId } = await import("@/db/accounts");
  const { createJob } = await import("@/lib/jobs");
  assert.equal(activeAccountId(), "privat");
  withAccount("default", () => createJob({ number: "100001", name: "Arbeitsjob" }));
  withAccount("privat", () => createJob({ number: "900009", name: "Privatjob" }));

  const work = await callTool(undefined, "list_jobs", {});
  assert.match(work, /100001/);
  assert.doesNotMatch(work, /900009/);

  const priv = await callTool("privat", "list_jobs", {});
  assert.match(priv, /900009/);
  assert.doesNotMatch(priv, /100001/);
});

test("an unknown account is refused, not served from another", async () => {
  const { handleMcp } = await import("@/mcp/http");
  const res = await handleMcp(new Request("http://127.0.0.1/api/mcp/nope", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), "nope");
  assert.equal(res.status, 404);
});
