import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * Where each part of Zeff runs — host (the default) or Docker — and what the launcher shows of Docker. The modules are the launcher's
 * (CommonJS); the container manager is a script of the app.
 */
const load = async (file: string) => {
  const m = await import(file);
  return (m.default ?? m) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const modes = () => load("../launcher/lib/modes.js");
const dockerLib = () => load("../launcher/lib/docker.js");
const appDocker = () => import("../scripts/app-docker.mjs");

test("by default everything runs on the host; what is read is held to what exists", async () => {
  const m = await modes();
  assert.deepEqual(m.defaults(), { stack: "host", knowledge: "host", claude: "host", copilot: "host", codex: "host" });
  assert.equal(m.defaults({ claudeDocker: true }).claude, "docker", "the older setting still asks for it");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modes-"));
  assert.deepEqual(m.read(dir, {}), m.defaults(), "no file: all on the host");
  fs.writeFileSync(path.join(dir, "modes.json"), JSON.stringify({ stack: "docker", claude: "docker", copilot: "nonsense", unknown: "docker", knowledge: 5 }));
  assert.deepEqual(m.read(dir, {}), { stack: "docker", knowledge: "host", claude: "docker", copilot: "host", codex: "host" });
  fs.writeFileSync(path.join(dir, "modes.json"), "{ not json");
  assert.deepEqual(m.read(dir, {}), m.defaults(), "a broken file: all on the host");
  const written = m.write(dir, { knowledge: "docker", bogus: "docker" });
  assert.deepEqual(written, { ...m.defaults(), knowledge: "docker" });
  assert.deepEqual(m.read(dir, {}), written);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0, "no temporary file stays");
});

test("the CLIs: a host service runs a switched CLI through its shim; the stack in Docker has them in its own container", async () => {
  const m = await modes();
  const app = path.join("C:", "Zeff");
  assert.deepEqual(m.cliEnv(m.defaults(), app), {}, "all on the host: nothing set");
  const env = m.cliEnv({ ...m.defaults(), claude: "docker", codex: "docker" }, app);
  assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CLI", "CODEX_CLI"]);
  assert.equal(env.CLAUDE_CLI, path.join(app, "scripts", "claude-docker.mjs"));
  assert.deepEqual(m.cliEnv({ ...m.defaults(), stack: "docker", claude: "docker" }, app), {}, "the stack's container runs them itself");
  assert.equal(m.aiContainerNeeded({ ...m.defaults(), copilot: "docker" }), true);
  assert.equal(m.aiContainerNeeded(m.defaults()), false);
  assert.equal(m.aiContainerNeeded({ ...m.defaults(), stack: "docker", claude: "docker" }), false, "the stack has the CLIs");
  assert.equal(m.notes({ ...m.defaults(), stack: "docker" }).claude, "Runs inside the Zeff container (it has the CLIs).");
  assert.deepEqual(m.notes(m.defaults()), {});
  assert.ok(m.SERVICES.every((s: { id: string; label: string; hint: string }) => s.id && s.label && s.hint), "each switch says what it is");
});

test("the containers the window shows: Zeff's marked, running first; Docker missing or stopped is an answer", async () => {
  const d = await dockerLib();
  const line = (o: object) => JSON.stringify({ ID: "abcdef0123456789", Image: "zeff-app:local", Status: "Up 3 minutes", State: "running", Ports: "127.0.0.1:9333->9333/tcp", Names: "zeff-stack", Labels: "zeff.service=stack,zeff.config=abc", ...o });
  assert.deepEqual(d.toContainer(line({})), { id: "abcdef012345", name: "zeff-stack", image: "zeff-app:local", state: "running", status: "Up 3 minutes", ports: "127.0.0.1:9333->9333/tcp", service: "stack", zeff: true });
  const ai = d.toContainer(line({ Names: "zeff-claude", Labels: "", Image: "zeff-claude:local" }));
  assert.equal(ai.zeff, true, "the AI-tools container has no label but a zeff- name");
  assert.equal(ai.service, null);
  const other = d.toContainer(line({ Names: "ddev-web", Labels: "com.ddev.x=1", Image: "ddev/ddev-webserver" }));
  assert.equal(other.zeff, false);
  assert.equal(d.toContainer("not json"), null);
  // docker is not on this machine's PATH in the test: it answers "not available" with a reason
  const savedPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const r = await d.list();
    assert.equal(r.available, false);
    assert.match(r.error, /not installed|not running/i);
    assert.deepEqual(r.containers, []);
  } finally {
    process.env.PATH = savedPath;
  }
});

test("a Zeff container: published on this computer only, the host's folders and the data mounted, the host's browser and key reached through the bridge", async () => {
  const { appRunArgs, containerName, pathMapOf, userMounts } = await appDocker();
  const mounts = [{ host: "C:\\Users\\me\\Documents", local: "/host/documents" }];
  assert.equal(containerName("stack"), "zeff-stack");
  assert.equal(containerName("knowledge"), "zeff-knowledge");
  assert.equal(containerName("knowledge", "privat"), "zeff-knowledge-privat");
  assert.equal(pathMapOf(mounts), "C:\\Users\\me\\Documents=/host/documents");
  assert.deepEqual(userMounts({ ZEFF_DOCKER_MOUNTS: "D:\\W=/host/w" }, "C:\\Users\\me"), [{ host: "D:\\W", local: "/host/w" }]);
  assert.deepEqual(userMounts({}, "C:\\Users\\me")[0].local, "/host/documents", "your Documents folder by default");
  const stack = appRunArgs({ kind: "stack", dataDir: "C:\\Zeff\\data", mounts, token: "tok" });
  const has = (a: string[], x: string) => a.includes(x);
  assert.ok(has(stack, "127.0.0.1:9333:9333"), "this computer only");
  assert.ok(has(stack, "C:\\Zeff\\data:/app/data") && has(stack, "C:\\Users\\me\\Documents:/host/documents") && has(stack, "zeff-claude-home:/home/node"));
  assert.ok(has(stack, "ZEFF_CDP_BASE=http://host.docker.internal") && has(stack, "ZEFF_BRIDGE_TOKEN=tok") && has(stack, "ZEFF_LOCK_WATCH=host"));
  assert.ok(has(stack, "ZEFF_PATH_MAP=C:\\Users\\me\\Documents=/host/documents"));
  assert.ok(has(stack, "no-new-privileges") && has(stack, "host.docker.internal:host-gateway") && has(stack, "zeff.service=stack"));
  assert.equal(stack.at(-1), "zeff-app:local", "the stack runs the image's own command (the supervisor)");
  const k = appRunArgs({ kind: "knowledge", account: "privat", port: 9556, dataDir: "C:\\Zeff\\data", knowledgeDir: "C:\\Zeff\\data\\accounts\\privat\\knowledge", mounts, token: "tok" });
  assert.ok(has(k, "127.0.0.1:9556:9556") && has(k, "zeff-knowledge-privat"));
  assert.ok(has(k, "C:\\Zeff\\data\\accounts\\privat\\knowledge:/knowledge-data") && has(k, "KNOWLEDGE_DATA_DIR=/knowledge-data") && has(k, "KNOWLEDGE_ACCOUNT=privat"));
  assert.ok(has(k, "ZEFF_URL=http://host.docker.internal:9333"), "it reaches Zeff on the host's published port");
  assert.ok(!k.some((a: string) => a.endsWith(":/app/data")), "a knowledge server does not get Zeff's database");
  assert.deepEqual(k.slice(-8), ["node", "node_modules/next/dist/bin/next", "start", "knowledge", "-H", "0.0.0.0", "-p", "9556"]);
  assert.throws(() => appRunArgs({ kind: "knowledge", dataDir: "d", mounts, token: "t" }), /port/);
  // the config label: a changed setting recreates the container
  const label = (a: string[]) => a.find((x) => x.startsWith("zeff.config="));
  assert.equal(label(stack), label(appRunArgs({ kind: "stack", dataDir: "C:\\Zeff\\data", mounts, token: "tok" })));
  assert.notEqual(label(stack), label(appRunArgs({ kind: "stack", dataDir: "C:\\Zeff\\data", mounts: [], token: "tok" })));
});

test("the stack's supervisor: pages, sync host from its own build, work host — wired to each other; the image has the CLIs", async () => {
  const { services, tokens } = await import("../docker/supervisor.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-"));
  const tok = tokens(dir);
  assert.equal(tok.work.length, 48);
  assert.deepEqual(tokens(dir), tok, "kept");
  const list = services({ app: "/app", data: dir, tok, bind: "0.0.0.0" });
  const by = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(by), ["web", "sync", "work"], "no knowledge server in it");
  assert.deepEqual(by.web.args.slice(-4), ["-H", "0.0.0.0", "-p", "9333"]);
  assert.equal(by.web.env.ZEFF_SYNC_TOKEN, by.sync.env.ZEFF_SYNC_TOKEN);
  assert.equal(by.sync.env.ZEFF_DIST_DIR, ".next-sync");
  assert.deepEqual(by.sync.args.slice(-4), ["-H", "127.0.0.1", "-p", "9336"]);
  assert.equal(by.work.env.ZEFF_WORK_TOKEN, tok.work);
  const docker = fs.readFileSync(path.join(__dirname, "..", "docker", "app", "Dockerfile"), "utf8");
  for (const needle of ["npx next build\\b", "npx next build knowledge", "\\.next-sync", "@anthropic-ai/claude-code", "@github/copilot", "@openai/codex", "^USER node$"]) assert.match(docker, new RegExp(needle, "m"), needle);
});

test("the launcher: the switches rebuild the services; the window lists the containers; a service in Docker is stopped by removing its container", async () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "launcher", "main.js"), "utf8");
  for (const needle of ["modes.read(", "modes.cliEnv(", "modes.aiContainerNeeded(", 'ipcMain.handle("modes"', 'ipcMain.handle("setModes"', 'ipcMain.handle("docker"', "app.relaunch()", 'spec("Bridge"']) assert.ok(main.includes(needle), needle);
  const supervisor = fs.readFileSync(path.join(__dirname, "..", "launcher", "lib", "supervisor.js"), "utf8");
  assert.ok(supervisor.includes("onStop"), "a service can say what stopping it also takes");
  const html = fs.readFileSync(path.join(__dirname, "..", "launcher", "status.html"), "utf8");
  assert.ok(html.includes('id="modes"') && html.includes('id="containers"'));
  const preload = fs.readFileSync(path.join(__dirname, "..", "launcher", "preload.js"), "utf8");
  for (const needle of ["modes:", "setModes:", "docker:"]) assert.ok(preload.includes(needle), needle);
});
