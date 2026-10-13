import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { setupTempData } from "./helpers";

// The sync host: a web server that has one hands the syncs and runs to it (and copies what it is doing) —
// the two sides here talk through the real route, over a real socket.
setupTempData();
process.env.ZEFF_SYNC_TOKEN = "secret";

let server: http.Server;
let url = "";
const seen: { op: string; account: string | null; auth: string | undefined }[] = [];

test.before(async () => {
  const { POST } = await import("@/app/api/sync-host/route");
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString();
      const j = JSON.parse(body || "{}") as { op?: string; account?: string };
      seen.push({ op: String(j.op), account: j.account ?? null, auth: req.headers.authorization });
      const r = await POST(new Request("http://host/api/sync-host", { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.authorization ?? "" }, body }));
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(await r.text());
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.after(() => server.close());

/** This process as the web server of a sync host (the host being the route above, in the same process). */
const asWeb = (on = true) => {
  process.env.ZEFF_ROLE = on ? "web" : "all";
  process.env.ZEFF_SYNC_HOST = on ? url : "";
};

test("roles: a web server without a host address does everything itself; with one it delegates", async () => {
  const { role, delegates, runsWork } = await import("@/lib/host/role");
  process.env.ZEFF_ROLE = "all";
  assert.deepEqual([role(), delegates(), runsWork()], ["all", false, true]);
  process.env.ZEFF_ROLE = "web";
  process.env.ZEFF_SYNC_HOST = "";
  assert.deepEqual([role(), delegates(), runsWork()], ["web", false, true], "no host address: as ever");
  process.env.ZEFF_SYNC_HOST = "http://127.0.0.1:9334/";
  assert.deepEqual([delegates(), runsWork()], [true, false]);
  process.env.ZEFF_ROLE = "sync";
  assert.deepEqual([role(), delegates(), runsWork()], ["sync", false, true], "the host itself works");
});

test("the host answers nobody without the shared secret, and not unknown operations", async () => {
  const { POST } = await import("@/app/api/sync-host/route");
  const ask = (auth: string | null, body: unknown) =>
    POST(new Request("http://host/api/sync-host", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
  assert.equal((await ask(null, { op: "snapshot" })).status, 401);
  assert.equal((await ask("Bearer wrong", { op: "snapshot" })).status, 401);
  assert.equal((await ask("Bearer secret", { op: "nope" })).status, 404);
  const ok = await ask("Bearer secret", { op: "snapshot" });
  assert.equal(ok.status, 200);
  const j = (await ok.json()) as { ok: boolean; result: { flags: object; syncs: { running: string[] } } };
  assert.equal(j.ok, true);
  assert.deepEqual(j.result.syncs.running, []);
  // A host without any secret configured answers nobody.
  process.env.ZEFF_SYNC_TOKEN = "";
  assert.equal((await ask("Bearer ", { op: "snapshot" })).status, 401);
  process.env.ZEFF_SYNC_TOKEN = "secret";
});

test("a web server hands start, stop and wait to the host — in its account, with the secret", async () => {
  const { startSync, stopSync, syncAndWait } = await import("@/lib/sync/registry");
  asWeb();
  seen.length = 0;
  // News isn't installed here: the host says so (that its answer comes back is the point).
  const r = await startSync("drivebackup");
  assert.equal(r.ok, false);
  assert.match(r.message, /not installed/i);
  assert.equal(await stopSync("jira"), false, "nothing running there");
  const waited = await syncAndWait("drivebackup");
  assert.equal(waited.lastOk === true, false);
  assert.deepEqual(
    seen.filter((s) => s.op !== "snapshot").map((s) => s.op),
    ["sync.start", "sync.stop", "sync.wait"],
  );
  assert.ok(seen.every((s) => s.auth === "Bearer secret" && s.account === "default"));
  asWeb(false);
});

test("the host being down is said so, not guessed: nothing starts, nothing hangs", async () => {
  const { startSync, stopSyncAll } = await import("@/lib/sync/registry");
  const { startBoardRunAnywhere } = await import("@/lib/host/commands");
  process.env.ZEFF_ROLE = "web";
  process.env.ZEFF_SYNC_HOST = "http://127.0.0.1:9"; // nothing there
  const r = await startSync("jira");
  assert.equal(r.ok, false);
  assert.match(r.message, /sync server isn't answering/);
  assert.equal((await startBoardRunAnywhere()).ok, false);
  assert.equal(await stopSyncAll(), false);
  asWeb(false);
});

test("the mirror: what the host is doing becomes the fields the pages read — and clears when it stops", async () => {
  const { buildSnapshot, applySnapshot, MIRRORED_FLAGS } = await import("@/lib/host/mirror");
  const g = globalThis as Record<string, unknown> & { __zeffSyncs?: { running: Set<string>; all: string | null | undefined } };
  // The host's side: a briefing run in its "ai" step, the news sync and "Sync all" on its way.
  g.__zeffBoardRun = { id: 7, phase: "ai", since: 1, provider: "Claude" };
  g.__zeffMailTodos = true;
  g.__zeffSyncs = { running: new Set(["news"]), all: "jira" };
  const snap = buildSnapshot();
  assert.deepEqual(snap.syncs, { running: ["news"], all: "jira" });
  assert.deepEqual(snap.flags.__zeffBoardRun, { id: 7, phase: "ai", since: 1, provider: "Claude" });
  assert.equal(snap.flags.__zeffMailTodos, true);
  assert.ok(!("__zeffSecret" in snap.flags) && MIRRORED_FLAGS.every((n) => n.startsWith("__zeff")), "only the listed fields leave");
  // The web side: it copies them; later, an idle host clears them.
  delete g.__zeffBoardRun;
  delete g.__zeffMailTodos;
  g.__zeffSyncs = { running: new Set(), all: undefined };
  applySnapshot(snap);
  assert.deepEqual(g.__zeffBoardRun, { id: 7, phase: "ai", since: 1, provider: "Claude" });
  assert.equal(g.__zeffMailTodos, true);
  assert.deepEqual([...g.__zeffSyncs!.running], ["news"]);
  assert.equal(g.__zeffSyncs!.all, "jira");
  applySnapshot({ flags: {}, syncs: { running: [], all: null }, backups: 0 });
  assert.equal(g.__zeffBoardRun, undefined);
  assert.equal(g.__zeffMailTodos, undefined);
  assert.equal(g.__zeffSyncs!.all, undefined);
  assert.equal(g.__zeffSyncs!.running.size, 0);
  // "Sync all" that is starting (no step yet) is kept apart from "not syncing all".
  applySnapshot({ flags: {}, syncs: { running: [], all: "" }, backups: 0 });
  assert.equal(g.__zeffSyncs!.all, null);
  applySnapshot(null);
});

test("a web server that delegates has nothing of its own to wait for in a deploy", async () => {
  const { busyThings } = await import("@/lib/host/busy");
  const g = globalThis as Record<string, unknown>;
  g.__zeffBoardRun = { id: 1, phase: "ai" };
  process.env.ZEFF_ROLE = "all";
  assert.match(busyThings().join(), /briefing run #1/);
  asWeb();
  assert.deepEqual(busyThings(), [], "the copy of the host's briefing isn't this server's");
  asWeb(false);
  delete g.__zeffBoardRun;
});
