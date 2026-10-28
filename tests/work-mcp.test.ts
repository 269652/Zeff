import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a worker's Zeff MCP server is its own account's endpoint, with that account's token only", async () => {
  const { workerMcpServers } = await import("@/lib/work/mcp");
  const { accountToken } = await import("@/lib/account-tokens");
  process.env.ZEFF_URL = "http://127.0.0.1:9333/";
  const c = workerMcpServers("privat", { "zeff-jira": { type: "stdio" } }, 7);
  assert.deepEqual(c.mcpServers.zeff, { type: "http", url: "http://127.0.0.1:9333/api/mcp/privat", headers: { Authorization: `Bearer ${accountToken("mcp", "privat")}`, "X-Zeff-Run": "7" } });
  assert.ok("zeff-jira" in c.mcpServers);
  assert.ok(!JSON.stringify(c).includes(accountToken("mcp", "default")), "nothing of work's");
});

test("a worker of an account that doesn't share this computer's setup gets none of Zeff's .env secrets", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const { envFileKeys } = await import("@/lib/work/runner");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-env-"));
  fs.writeFileSync(path.join(dir, ".env"), "JIRA_PERSONAL_TOKEN=abc\n# COMMENTED=1\nexport GITLAB_TOKEN = x\n");
  fs.writeFileSync(path.join(dir, ".env.local"), "GOOGLE_CLIENT_SECRET=s\n");
  assert.deepEqual([...envFileKeys(dir)].sort(), ["GITLAB_TOKEN", "GOOGLE_CLIENT_SECRET", "JIRA_PERSONAL_TOKEN"]);
  const { addAccount, setAccountsInstalled, sharesWorkerSetup, updateAccount } = await import("@/db/accounts");
  setAccountsInstalled(true);
  const other = addAccount("Privat", "emerald");
  assert.equal(sharesWorkerSetup("default"), true, "the first account: as before");
  assert.equal(sharesWorkerSetup(other.id), false, "another: not unless you say so");
  updateAccount(other.id, { workerSetup: true });
  assert.equal(sharesWorkerSetup(other.id), true);
});
