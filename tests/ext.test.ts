import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const plugins = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
process.env.ZEFF_PLUGINS_DIR = plugins;

const write = (id: string, manifest: unknown, files: Record<string, string> = {}) => {
  const dir = path.join(plugins, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zeff-plugin.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
};
const base = { name: "T", apiVersion: 1 };

test("a manifest is checked: ids, permissions the contributions need, paths inside the folder", async () => {
  await import("@/lib/plugins/api"); // the plugins register the permissions a manifest may ask for
  const { parseManifest } = await import("@/lib/ext/manifest");
  const ok = parseManifest(JSON.stringify({ ...base, id: "my-plugin" }));
  assert.ok(parseManifest(JSON.stringify({ ...base, id: "my-plugin", permissions: ["todos.write", "work.read", "exec"] })).ok, "permissions plugins bring are fine");
  assert.ok(ok.ok);
  const bad = (m: object) => {
    const r = parseManifest(JSON.stringify({ ...base, id: "p-x", ...m }));
    assert.ok(!r.ok, JSON.stringify(m));
    return r.ok ? "" : r.error;
  };
  assert.match(bad({ id: "Bad Id" }), /id/);
  assert.match(bad({ id: "sdk" }), /reserved/);
  assert.match(bad({ apiVersion: 2 }), /apiVersion/);
  // What a contribution does needs its permission.
  assert.match(bad({ contributes: { hooks: { "work.run.finished": { command: ["node", "x.mjs"] } } } }), /exec/);
  assert.match(bad({ contributes: { workerRules: "rules.md" } }), /prompt/);
  assert.match(bad({ contributes: { workerMcpServers: { s: { command: "node" } } } }), /exec/);
  assert.match(bad({ contributes: { workerMcpServers: { s: { url: "https://x.example/mcp" } } } }), /network/);
  // Paths stay in the folder; ids are unique; unknown permissions and events are refused.
  assert.match(bad({ permissions: ["prompt"], contributes: { workerRules: "../x.md" } }), /inside the plugin/);
  assert.match(bad({ contributes: { workPanels: [{ id: "a", title: "A", entry: "/etc/passwd" }] } }), /inside the plugin/);
  assert.match(bad({ contributes: { workCommands: [{ id: "a", label: "A", template: "x" }, { id: "a", label: "B", template: "y" }] } }), /twice/);
  assert.match(bad({ permissions: ["root"] }), /permissions/);
  assert.match(bad({ permissions: ["exec"], contributes: { hooks: { "mail.arrived": { command: ["x"] } } } }), /hooks/);
  // Defaults, and rules given as one path.
  const full = parseManifest(JSON.stringify({ ...base, id: "full", permissions: ["prompt"], contributes: { workerRules: "r.md" } }));
  assert.ok(full.ok && full.manifest.contributes.workerRules[0] === "r.md" && full.manifest.version === "0.0.0");
  assert.ok(!parseManifest("{ nope").ok);
});

test("plugins are found without a restart; what's wrong with a folder is said; on/off and permissions are per account", async () => {
  const reg = await import("@/lib/ext/registry");
  write("good", { ...base, id: "good", permissions: ["work.read"] });
  write("mismatch", { ...base, id: "other" });
  write("broken", "{ not json");
  fs.mkdirSync(path.join(plugins, "empty"));
  const scan = reg.scanPlugins(true);
  assert.deepEqual(scan.plugins.map((p) => p.id), ["good"]);
  assert.deepEqual(scan.problems.map((p) => p.dir).sort(), ["broken", "empty", "mismatch"]);
  assert.match(scan.problems.find((p) => p.dir === "mismatch")!.error, /named like/);

  // Off unless turned on; then it holds what it asked for.
  assert.equal(reg.getPlugin("good")!.enabled, false);
  assert.equal(reg.getPlugin("good")!.permissions.size, 0);
  reg.setEnabled("good", true);
  assert.deepEqual([...reg.getPlugin("good")!.permissions], ["work.read"]);
  assert.throws(() => reg.setEnabled("missing", true), /No plugin/);

  // An update asking for more: held back until it's turned on again.
  write("good", { ...base, id: "good", permissions: ["work.read", "work.write"] });
  reg.scanPlugins(true);
  const updated = reg.getPlugin("good")!;
  assert.deepEqual([...updated.permissions], ["work.read"]);
  assert.deepEqual(updated.ungranted, ["work.write"]);
  reg.setEnabled("good", false);
  assert.equal(reg.getPlugin("good")!.enabled, false);
  reg.setEnabled("good", true);
  assert.deepEqual([...reg.getPlugin("good")!.permissions].sort(), ["work.read", "work.write"]);
});

test("a token is a plugin's own: another id or a changed signature doesn't pass", async () => {
  const { tokenFor, pluginOfToken } = await import("@/lib/ext/token");
  const t = tokenFor("good");
  assert.equal(pluginOfToken(t), "good");
  assert.equal(pluginOfToken(t.replace(/^good/, "evil")), null);
  assert.equal(pluginOfToken(`${t.slice(0, -1)}${t.endsWith("0") ? "1" : "0"}`), null);
  assert.equal(pluginOfToken("good"), null);
  assert.equal(pluginOfToken(""), null);
});

test("a panel's files come from ui/ only and can't leave it", async () => {
  const { resolveAsset, assetCsp } = await import("@/lib/ext/assets");
  const dir = write("assets", { ...base, id: "assets" }, { "ui/index.html": "<p>hi</p>", "ui/sub/a.css": "a{}", "ui/.secret.json": "{}", "secret.txt": "no", "hook.mjs": "x", "ui/data.exe": "x" });
  assert.ok(resolveAsset(dir, ["index.html"]));
  assert.equal(resolveAsset(dir, ["sub", "a.css"])?.type, "text/css; charset=utf-8");
  for (const bad of [["..", "secret.txt"], ["..", "hook.mjs"], [".secret.json"], ["sub", "..", "..", "secret.txt"], ["nope.html"], ["data.exe"], ["sub"], [], ["a\\b.css"], ["C:", "x.html"], ["index.html\0"]]) assert.equal(resolveAsset(dir, bad), null, JSON.stringify(bad));
  // A link out of the folder doesn't count (where links can be made).
  try {
    fs.symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "ui", "link.txt"));
    assert.equal(resolveAsset(dir, ["link.txt"]), null);
  } catch {
    // no permission to make links here
  }
  assert.match(assetCsp(false), /^sandbox allow-scripts/);
  assert.doesNotMatch(assetCsp(false), /allow-same-origin/);
  assert.match(assetCsp(false), /connect-src 'self'/);
  assert.match(assetCsp(true), /connect-src \*/);
});

test("the API: permissions are checked, storage is the plugin's own, bad input is said", async () => {
  const reg = await import("@/lib/ext/registry");
  const { callExt } = await import("@/lib/ext/api");
  write("api-a", { ...base, id: "api-a", permissions: ["todos.read", "todos.write"] });
  write("api-b", { ...base, id: "api-b" });
  reg.scanPlugins(true);
  reg.setEnabled("api-a", true);
  reg.setEnabled("api-b", true);
  const a = reg.getPlugin("api-a")!;
  const b = reg.getPlugin("api-b")!;

  const hello = await callExt(a, "hello", {});
  assert.ok(hello.ok);
  assert.deepEqual((hello.ok && (hello.result as { permissions: string[] }).permissions)?.sort(), ["todos.read", "todos.write"]);

  // No permission, no answer — not even for the first thing a method does.
  const denied = await callExt(b, "todos.list", {});
  assert.ok(!denied.ok && denied.status === 403 && denied.error.code === "permission" && /todos.read/.test(denied.error.message));
  assert.ok(!(await callExt(b, "work.sessions.start", { instruction: "x" })).ok);
  assert.ok(!(await callExt(b, "nope", {})).ok);
  assert.ok(!(await callExt(b, "toString", {})).ok);
  assert.ok(!(await callExt(b, "hello", [] as unknown as object)).ok);

  // Storage: each plugin its own.
  assert.ok((await callExt(a, "storage.set", { key: "k", value: { n: 1 } })).ok);
  const got = await callExt(a, "storage.get", { key: "k" });
  assert.ok(got.ok && JSON.stringify(got.result) === '{"n":1}');
  const other = await callExt(b, "storage.get", { key: "k" });
  assert.ok(other.ok && other.result === null);
  assert.deepEqual((await callExt(a, "storage.keys", {})).ok && (await callExt(a, "storage.keys", {})), { ok: true, result: ["k"] });
  assert.ok((await callExt(a, "storage.delete", { key: "k" })).ok);
  assert.ok(!(await callExt(a, "storage.set", { key: "", value: 1 })).ok);
  assert.ok(!(await callExt(a, "storage.set", { key: "x" })).ok);
  assert.ok(!(await callExt(a, "storage.set", { key: "big", value: "x".repeat(1_100_000) })).ok);

  // Todos through the API.
  const added = await callExt(a, "todos.add", { text: "From a plugin", ticket: "ABC-1" });
  assert.ok(added.ok);
  const list = await callExt(a, "todos.list", { status: "open" });
  assert.ok(list.ok && (list.result as { text: string }[]).some((t) => t.text === "From a plugin"));
  assert.ok(!(await callExt(a, "todos.add", { text: "x", ticket: "not a key" })).ok);
  assert.ok(!(await callExt(a, "todos.list", { status: "weird" })).ok);
});

test("the API route: a token or Zeff's own page, never another website; a plugin that's off is refused", async () => {
  const { POST } = await import("@/app/api/ext/v1/[method]/route");
  const { tokenFor } = await import("@/lib/ext/token");
  const reg = await import("@/lib/ext/registry");
  write("route-p", { ...base, id: "route-p", permissions: ["todos.read"] });
  reg.scanPlugins(true);
  const call = (method: string, headers: Record<string, string>, body: unknown = {}) =>
    POST(new Request(`http://127.0.0.1:9333/api/ext/v1/${method}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ method }) });

  const token = { authorization: `Bearer ${tokenFor("route-p")}` };
  assert.equal((await call("hello", token)).status, 403, "off: refused");
  reg.setEnabled("route-p", true);
  const ok = await call("hello", token);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { result: { plugin: { id: string } } }).result.plugin.id, "route-p");

  assert.equal((await call("hello", {})).status, 401, "no token");
  assert.equal((await call("hello", { authorization: "Bearer route-p.0000" })).status, 401, "forged token");
  // A panel's page: the plugin named by the page, accepted only as the browser's own same-origin request.
  assert.equal((await call("hello", { "x-zeff-ext-panel": "route-p" })).status, 401, "claimed by a script");
  assert.equal((await call("hello", { "x-zeff-ext-panel": "route-p", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:9333" })).status, 200);
  // Another website: refused before anything else.
  assert.equal((await call("hello", { ...token, origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await call("hello", { ...token, origin: "null" })).status, 403, "a sandboxed frame calling directly");
  // Errors come as { ok: false, error }.
  const nope = await call("work.sessions.start", token, { instruction: "x" });
  const j = (await nope.json()) as { ok: boolean; error: { code: string } };
  assert.equal(nope.status, 403);
  assert.deepEqual([j.ok, j.error.code], [false, "permission"]);
  assert.equal((await call("hello", { ...token, "x-zeff-account": "nobody" })).status, 400);
});

test("what Work takes from plugins: rules, MCP servers, commands, panels", async () => {
  const reg = await import("@/lib/ext/registry");
  const w = await import("@/lib/ext/work");
  write(
    "work-p",
    {
      ...base,
      id: "work-p",
      name: "Work P",
      permissions: ["prompt", "exec", "network"],
      contributes: {
        workerRules: ["rules.md", "missing.md"],
        workCommands: [{ id: "review", label: "Review", description: "d", template: "Review {{x}}" }],
        workerMcpServers: { local: { command: "node", args: ["./server.mjs"], env: { A: "1" } }, remote: { url: "https://mcp.example/x" } },
        workPanels: [
          { id: "dash", title: "Dashboard", entry: "index.html" },
          { id: "side", title: "Side", entry: "side.html", placement: "session" },
        ],
      },
    },
    { "rules.md": "Always answer in haiku." },
  );
  write("work-q", { ...base, id: "work-q", name: "Quiet", contributes: { workCommands: [{ id: "c", label: "C", template: "t" }] } });
  reg.scanPlugins(true);
  // Off: nothing.
  assert.equal(w.extWorkerRules(), "");
  assert.deepEqual(w.extWorkCommands(), []);
  assert.deepEqual(w.extWorkerMcpServers(), {});
  assert.deepEqual(w.extWorkPanels(), []);
  reg.setEnabled("work-p", true);
  reg.setEnabled("work-q", true);

  assert.match(w.extWorkerRules(), /Work P \(work-p\)\nAlways answer in haiku\./);
  assert.deepEqual(w.extWorkCommands().map((c) => c.id), ["work-p:review", "work-q:c"]);
  assert.deepEqual(w.extWorkPanels("tab").map((p) => p.href), ["/ext/view/work-p/dash"]);
  assert.deepEqual(w.extWorkPanels("session").map((p) => p.id), ["work-p:side"]);
  const mcp = w.extWorkerMcpServers() as Record<string, { type: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string }>;
  assert.deepEqual(Object.keys(mcp).sort(), ["ext-work-p-local", "ext-work-p-remote"]);
  assert.equal(mcp["ext-work-p-local"].command, process.execPath, '"node" is the Node running Zeff');
  assert.equal(mcp["ext-work-p-local"].args![0], path.join(plugins, "work-p", "server.mjs"));
  assert.equal(mcp["ext-work-p-local"].env!.A, "1");
  assert.match(mcp["ext-work-p-local"].env!.ZEFF_EXT_TOKEN, /^work-p\./);
  assert.equal(mcp["ext-work-p-remote"].url, "https://mcp.example/x");
  // The worker's MCP config gets them too.
  const { workerMcpServers } = await import("@/lib/work/mcp");
  assert.ok("ext-work-p-local" in workerMcpServers("default").mcpServers);
  assert.ok("zeff" in workerMcpServers("default").mcpServers);
});

test("a hook gets the event on stdin, in its folder, with the API environment; a slow or unpermitted one doesn't run on", async () => {
  const reg = await import("@/lib/ext/registry");
  const { emitExtEvent, hookLog } = await import("@/lib/ext/hooks");
  const dir = write(
    "hook-p",
    { ...base, id: "hook-p", permissions: ["exec"], contributes: { hooks: { "work.run.finished": { command: ["node", "./hook.mjs"], timeoutMs: 5000 }, "work.changed": { command: ["node", "./slow.mjs"], timeoutMs: 400 } } } },
    {
      "hook.mjs": 'import fs from "node:fs"; let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>fs.writeFileSync("out.json", JSON.stringify({ stdin: JSON.parse(s), env: { id: process.env.ZEFF_EXT_ID, token: !!process.env.ZEFF_EXT_TOKEN, api: process.env.ZEFF_API_URL, account: process.env.ZEFF_ACCOUNT, event: process.env.ZEFF_EVENT, cwd: process.cwd(), leaked: process.env.ZEFF_WORK_TOKEN ?? null } })));',
      "slow.mjs": "setTimeout(()=>{}, 60000);",
    },
  );
  write("hook-noexec", { ...base, id: "hook-noexec", permissions: [] });
  reg.scanPlugins(true);

  // Off: nothing runs.
  emitExtEvent("work.run.finished", { runId: 1 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fs.existsSync(path.join(dir, "out.json")), false);

  reg.setEnabled("hook-p", true);
  process.env.ZEFF_WORK_TOKEN = "must-not-reach-plugins";
  emitExtEvent("work.run.finished", { runId: 7, status: "done" });
  // (Until the file is whole: it exists as soon as the hook opens it, a slow machine may show it half written.)
  const written = () => {
    try {
      JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 150 && !written(); i++) await new Promise((r) => setTimeout(r, 100));
  const out = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8")) as { stdin: { event: string; plugin: string; data: { runId: number } }; env: Record<string, unknown> };
  assert.equal(out.stdin.event, "work.run.finished");
  assert.equal(out.stdin.plugin, "hook-p");
  assert.equal(out.stdin.data.runId, 7);
  assert.equal(out.env.id, "hook-p");
  assert.equal(out.env.token, true);
  assert.equal(out.env.event, "work.run.finished");
  assert.equal(fs.realpathSync(out.env.cwd as string), fs.realpathSync(dir));
  assert.match(out.env.api as string, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(out.env.leaked, null, "Zeff's own secrets stay out");
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(hookLog("hook-p").some((r) => r.event === "work.run.finished" && r.ok));

  // A hook that doesn't end is killed, and the log says so.
  emitExtEvent("work.changed", {});
  for (let i = 0; i < 50 && !hookLog("hook-p").some((r) => r.event === "work.changed"); i++) await new Promise((r) => setTimeout(r, 100));
  const slow = hookLog("hook-p").find((r) => r.event === "work.changed")!;
  assert.ok(slow && !slow.ok && /timed out/.test(slow.output));

  // Without the exec permission granted, a manifest's hooks aren't run: held back when an update adds them.
  write("hook-p", { ...base, id: "hook-p", permissions: [], contributes: {} });
  reg.scanPlugins(true);
  fs.rmSync(path.join(dir, "out.json"));
  emitExtEvent("work.run.finished", {});
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(fs.existsSync(path.join(dir, "out.json")), false);
  delete process.env.ZEFF_WORK_TOKEN;
});

test("the manifest's JSON Schema file and the permission texts are in step with the code", async () => {
  const { manifestJsonSchema } = await import("@/lib/ext/schema");
  const { permissionTexts } = await import("@/lib/ext/permission-texts");
  const file = fs.readFileSync(path.join(process.cwd(), "docs", "plugins", "zeff-plugin.schema.json"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(file, manifestJsonSchema(), "docs/plugins/zeff-plugin.schema.json is out of date: npm run plugin:schema");
  // Zeff's three and those of Work and Todos (installed by default or not, the texts are the plugins' own).
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["work", "todos"]) setInstalled(id, true);
  const words = permissionTexts();
  for (const id of ["prompt", "exec", "network", "work.read", "work.write", "todos.read", "todos.write"]) assert.ok(words[id], `no text for the permission ${id}`);
});

test("the docs name every API method, event and permission; the examples are valid plugins", async () => {
  const { apiMethods, knownPermissions } = await import("@/lib/plugins/api");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["work", "todos", "workspace"]) setInstalled(id, true);
  const METHODS = apiMethods();
  const { allEvents } = await import("@/lib/plugins/api-point");
  const { checkPluginFolder } = await import("@/lib/ext/check");
  const doc = (n: string) => fs.readFileSync(path.join(process.cwd(), "docs", "plugins", `${n}.md`), "utf8");
  for (const m of Object.keys(METHODS)) assert.ok(doc("api").includes(`\`${m}\``), `api.md doesn't document ${m}`);
  for (const e of allEvents()) assert.ok(doc("hooks").includes(`\`${e.id}\``), `hooks.md doesn't document ${e.id}`);
  for (const p of Object.keys(knownPermissions())) assert.ok(doc("manifest").includes(`\`${p}\``), `manifest.md doesn't document ${p}`);
  // Every method a panel's helper calls exists (the SDK is plain text: its call("…") names are checked here).
  const { SDK_JS } = await import("@/lib/ext/sdk");
  const clientOnly = new Set(["ui.toast", "ui.navigate", "ui.resize"]);
  for (const [, name] of SDK_JS.matchAll(/call\("([a-z.]+)"/g)) assert.ok(name in METHODS || clientOnly.has(name), `the SDK calls ${name}, which doesn't exist`);
  for (const dir of fs.readdirSync(path.join(process.cwd(), "examples", "plugins"))) {
    const r = checkPluginFolder(path.join(process.cwd(), "examples", "plugins", dir));
    assert.deepEqual([r.errors, r.warnings], [[], []], dir);
  }
  // A folder that isn't right is said so.
  const bad = write("check-bad", { ...base, id: "check-bad", permissions: ["exec", "prompt"], contributes: { hooks: { "work.run.finished": { command: ["node", "./gone.mjs"] } }, workerRules: "missing.md", workPanels: [{ id: "a", title: "A", entry: "nope.html" }] } });
  const r = checkPluginFolder(bad);
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 3, r.errors.join(" | "));
  assert.ok(!checkPluginFolder(path.join(plugins, "work-q")).errors.length);
});

test("panel files are served sandboxed, from ui/ only, and only while the plugin is on", async () => {
  const reg = await import("@/lib/ext/registry");
  const { GET } = await import("@/app/ext/[plugin]/[...path]/route");
  const sdk = await import("@/app/ext/sdk/[file]/route");
  write("serve-p", { ...base, id: "serve-p", permissions: [] }, { "ui/index.html": "<h1>hi</h1>", "ui/app.js": "1", "private.txt": "secret" });
  reg.scanPlugins(true);
  const get = (segments: string[], headers: Record<string, string> = {}) =>
    GET(new Request(`http://127.0.0.1:9333/ext/serve-p/${segments.join("/")}`, { headers }), { params: Promise.resolve({ plugin: "serve-p", path: segments }) });

  assert.equal((await get(["index.html"])).status, 404, "off: not served");
  reg.setEnabled("serve-p", true);
  const ok = await get(["index.html"]);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "<h1>hi</h1>");
  assert.match(ok.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts/);
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ok.headers.get("access-control-allow-origin"), null, "no CORS for others");
  assert.equal((await get(["index.html"], { origin: "null" })).headers.get("access-control-allow-origin"), "null", "a sandboxed frame's module scripts");
  assert.equal((await get(["..", "private.txt"])).status, 404);
  assert.equal((await get(["private.txt"])).status, 404, "outside ui/");
  assert.equal((await get(["%2e%2e%2fprivate.txt"])).status, 404);
  assert.equal((await get(["%E0%A4%A"])).status, 404, "a malformed path");
  const etag = ok.headers.get("etag")!;
  assert.equal((await get(["index.html"], { "if-none-match": etag })).status, 304);

  const sdkGet = (file: string) => sdk.GET(new Request(`http://127.0.0.1:9333/ext/sdk/${file}`), { params: Promise.resolve({ file }) });
  const js = await sdkGet("zeff.js");
  assert.equal(js.status, 200);
  assert.match(await js.text(), /window\.zeff = zeff/);
  assert.match(await (await sdkGet("zeff.css")).text(), /--zeff-accent/);
  assert.match(await (await sdkGet("zeff-plugin.schema.json")).text(), /"apiVersion"/);
  assert.equal((await sdkGet("nope.js")).status, 404);
});

test('the "/" commands reach the message box through the server action', async () => {
  const { listWorkCommandsAction } = await import("@/lib/ext/actions");
  const cmds = await listWorkCommandsAction();
  assert.ok(cmds.some((c) => c.id === "work-p:review" && c.template === "Review {{x}}"));
});

test("a run's start and end reach the hooks with its final state", async () => {
  const reg = await import("@/lib/ext/registry");
  const { announceRun } = await import("@/lib/ext/work");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const dir = write(
    "announce-p",
    { ...base, id: "announce-p", permissions: ["exec"], contributes: { hooks: { "work.run.started": { command: ["node", "./h.mjs"] }, "work.run.finished": { command: ["node", "./h.mjs"] } } } },
    { "h.mjs": 'import fs from "node:fs"; const e = JSON.parse(fs.readFileSync(0, "utf8")); fs.appendFileSync("events.log", e.event + " " + e.data.run.status + " " + e.data.run.ref + " " + (e.data.run.error ?? "") + "\\n");' },
  );
  reg.scanPlugins(true);
  reg.setEnabled("announce-p", true);
  const run = createRun({ ticket: "ABC-1", todoId: 1, mode: "instruct", provider: "claude", model: "m", permissionMode: null, repo: null, prompt: "x" });
  updateRun(run.id, { status: "running", startedAt: new Date().toISOString() });
  announceRun(run.id, "work.run.started");
  updateRun(run.id, { status: "failed", error: "boom", finishedAt: new Date().toISOString() });
  announceRun(run.id, "work.run.finished");
  announceRun(999999, "work.run.finished"); // a run that doesn't exist: nothing, no throw
  const log = path.join(dir, "events.log");
  for (let i = 0; i < 100 && !(fs.existsSync(log) && fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length >= 2); i++) await new Promise((r) => setTimeout(r, 100));
  const { hookLog } = await import("@/lib/ext/hooks");
  assert.ok(fs.existsSync(log), JSON.stringify(hookLog("announce-p")));
  const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).sort();
  assert.deepEqual(lines, [`work.run.finished failed W-${run.id} boom`, `work.run.started running W-${run.id} `].sort());
});

test("the docs are served as plain Markdown, the README with this computer's plugins folder", async () => {
  const { GET } = await import("@/app/ext/raw/[name]/route");
  const get = (name: string) => GET(new Request(`http://127.0.0.1:9333/ext/raw/${name}`), { params: Promise.resolve({ name }) });
  const readme = await get("README");
  assert.equal(readme.status, 200);
  assert.match(readme.headers.get("content-type") ?? "", /^text\/markdown/);
  const text = await readme.text();
  assert.ok(text.includes(`The plugins folder on this computer: ${plugins}`));
  assert.match(text, /# Zeff external plugins/);
  for (const n of ["manifest", "api", "panels", "hooks", "security", "api.md"]) assert.equal((await get(n)).status, 200, n);
  assert.equal((await get("../../package")).status, 404);
  assert.equal((await get("nope")).status, 404);
});

test("a run as plugins see it keeps the same ref as Work's", async () => {
  const { runBrief } = await import("@/lib/ext/work");
  const { workRef } = await import("@/lib/work/shared");
  assert.equal(runBrief({ id: 7, ticket: "", todoId: 1, status: "done", mode: "code", provider: "claude", model: null, outcome: null, summary: null, error: null, branch: null, startedAt: null, finishedAt: null, durationMs: null, costUsd: null }).ref, workRef(7));
});

test("the docs render in the app: no bold or code span runs over a line break (the in-app Markdown is a small subset)", () => {
  for (const file of fs.readdirSync(path.join(process.cwd(), "docs", "plugins")).filter((f) => f.endsWith(".md"))) {
    let code = false;
    fs.readFileSync(path.join(process.cwd(), "docs", "plugins", file), "utf8").split(/\r?\n/).forEach((line, i) => {
      if (line.trim().startsWith("```")) return void (code = !code);
      if (code) return;
      assert.equal(line.replace(/`[^`]*`/g, "").split("**").length % 2, 1, `${file}:${i + 1}: a ** span runs over the line's end`);
      assert.equal(line.split("`").length % 2, 1, `${file}:${i + 1}: a \` span runs over the line's end`);
    });
  }
});
