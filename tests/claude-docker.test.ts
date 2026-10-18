import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Claude Code in a Docker container: Zeff runs scripts/claude-docker.mjs in place of the CLI, which forwards the call into the service
 * container — the paths put right, Zeff's MCP server reached at the host, the run's claude killable inside.
 */
const mod = import("../scripts/claude-docker.mjs");

const MOUNTS = [
  { host: "C:\\Users\\me\\Documents", local: "/host/documents" },
  { host: "C:\\Zeff\\data\\work\\attachments", local: "/host/zeff/attachments", readOnly: true },
];

test("the mounts: written as host=container pairs, :ro for read-only", async () => {
  const { parseMounts } = await mod;
  assert.deepEqual(parseMounts("C:\\Users\\me\\Documents=/host/documents;D:\\Work=/host/work:ro"), [
    { host: "C:\\Users\\me\\Documents", local: "/host/documents" },
    { host: "D:\\Work", local: "/host/work", readOnly: true },
  ]);
  assert.deepEqual(parseMounts(""), []);
  assert.deepEqual(parseMounts("nonsense;=/x;C:\\a=relative"), [], "both sides, the container's absolute");
});

test("paths: a host path under a mount is the container's — on a folder boundary, any slash, any case; others stay", async () => {
  const { toContainerPath, mapArg } = await mod;
  assert.equal(toContainerPath("C:\\Users\\me\\Documents\\PROJ\\repo", MOUNTS), "/host/documents/PROJ/repo");
  assert.equal(toContainerPath("c:/users/me/documents/PROJ/repo/", MOUNTS), "/host/documents/PROJ/repo");
  assert.equal(toContainerPath("C:\\Users\\me\\Documents", MOUNTS), "/host/documents");
  assert.equal(toContainerPath("C:\\Users\\me\\Documents2\\x", MOUNTS), null);
  assert.equal(toContainerPath("D:\\elsewhere", MOUNTS), null);
  assert.equal(mapArg("C:\\Zeff\\data\\work\\attachments\\7\\shot.png", MOUNTS), "/host/zeff/attachments/7/shot.png");
  assert.equal(mapArg("--add-dir=C:\\Users\\me\\Documents\\x", MOUNTS), "--add-dir=/host/documents/x");
  assert.equal(mapArg("--model", MOUNTS), "--model");
  assert.equal(mapArg("a text with C:\\Users\\me\\Documents\\x inside", MOUNTS), "a text with C:\\Users\\me\\Documents\\x inside", "only an argument that is a path");
});

test("Zeff's MCP server is on the host: loopback addresses become host.docker.internal; a program to start is left out", async () => {
  const { hostAddress, containerMcpConfig } = await mod;
  assert.equal(hostAddress("http://127.0.0.1:9333/api/mcp/default"), "http://host.docker.internal:9333/api/mcp/default");
  assert.equal(hostAddress("https://localhost/x"), "https://host.docker.internal/x");
  assert.equal(hostAddress("https://example.com/127.0.0.1"), "https://example.com/127.0.0.1");
  const file = JSON.stringify({ mcpServers: { zeff: { type: "http", url: "http://127.0.0.1:9333/api/mcp/privat", headers: { "X-Zeff-Run": "12" } }, jira: { command: "node", args: ["C:\\x\\jira.js"] } } });
  const warnings: string[] = [];
  const out = JSON.parse(containerMcpConfig("C:\\data\\jira-mcp-12.json", { read: () => file, warn: (s: string) => warnings.push(s) })!);
  assert.deepEqual(Object.keys(out.mcpServers), ["zeff"]);
  assert.equal(out.mcpServers.zeff.url, "http://host.docker.internal:9333/api/mcp/privat");
  assert.deepEqual(out.mcpServers.zeff.headers, { "X-Zeff-Run": "12" });
  assert.match(warnings[0], /"jira".*cannot run in the container/);
  // inline JSON works the same, and what is no file and no JSON is not ours
  assert.ok(JSON.parse(containerMcpConfig(file, { read: () => { throw new Error("no file"); }, warn: () => {} })!).mcpServers.zeff);
  assert.equal(containerMcpConfig("C:\\nope.json", { read: () => { throw new Error("no file"); } }), null);
});

test("the call: docker exec -i in the mapped folder, the run's identity in, the host's environment out, claude as its own process group", async () => {
  const { execArgs } = await mod;
  const call = execArgs({
    argv: ["-p", "--output-format", "stream-json", "--mcp-config", "C:\\data\\mcp.json", "--add-dir", "C:\\Zeff\\data\\work\\attachments", "--model", "sonnet"],
    cwd: "C:\\Users\\me\\Documents\\PROJ\\repo",
    env: { ZEFF_WORK_RUN: "42", ZEFF_WORK_ACCOUNT: "privat", CLAUDE_CODE_ENTRYPOINT: "x", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k", PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\me", CLAUDE_CLI: "C:\\Zeff\\scripts\\claude-docker.mjs" },
    mounts: MOUNTS,
    read: () => JSON.stringify({ mcpServers: { zeff: { type: "http", url: "http://127.0.0.1:9333/api/mcp/privat" } } }),
  });
  assert.deepEqual(call.slice(0, 4), ["exec", "-i", "-w", "/host/documents/PROJ/repo"]);
  const env = call.flatMap((a: string, i: number) => (call[i - 1] === "-e" ? [a] : []));
  assert.deepEqual(env.sort(), ["ANTHROPIC_API_KEY=k", "ZEFF_WORK_ACCOUNT=privat", "ZEFF_WORK_RUN=42"], "Claude's and the run's variables only — not the host's PATH, not the nesting guards");
  const at = call.indexOf("sh");
  assert.equal(call[at - 1], "zeff-claude");
  assert.match(call[at + 2], /echo \$\$ > \/tmp\/zeff-run\/42\.pid; exec setsid "\$@"/);
  assert.deepEqual(call.slice(at + 3, at + 5), ["sh", "claude"]);
  const rest = call.slice(at + 5);
  assert.deepEqual(rest.slice(0, 3), ["-p", "--output-format", "stream-json"]);
  assert.equal(rest[rest.indexOf("--mcp-config") + 1].includes("host.docker.internal:9333"), true, "the MCP config inline, at the host");
  assert.equal(rest[rest.indexOf("--add-dir") + 1], "/host/zeff/attachments");
  // A folder that is not mounted (the temp folder of the mail review): the container's /tmp. No run: no pid file.
  const headless = execArgs({ argv: ["-p"], cwd: "C:\\Users\\me\\AppData\\Local\\Temp\\zeff-boards", env: {}, mounts: MOUNTS });
  assert.equal(headless[3], "/tmp");
  assert.equal(headless[headless.indexOf("-c") + 1], 'exec setsid "$@"');
});

test("the service container: detached or in the foreground, the mounts and the volume, the host reachable, no new privileges", async () => {
  const { runArgs } = await mod;
  const bg = runArgs({ mounts: MOUNTS });
  assert.equal(bg[0], "run");
  assert.ok(bg.includes("-d") && bg.includes("unless-stopped") && !bg.includes("--rm"));
  assert.ok(bg.includes("host.docker.internal:host-gateway"));
  assert.ok(bg.includes("no-new-privileges"));
  assert.ok(bg.includes("127.0.0.1:9335:9335"), "the health port: this computer only");
  assert.ok(bg.includes("zeff-claude-home:/home/node"));
  assert.ok(bg.includes("C:\\Users\\me\\Documents:/host/documents"));
  assert.ok(bg.includes("C:\\Zeff\\data\\work\\attachments:/host/zeff/attachments:ro"), "what Zeff hands over is read-only");
  assert.equal(bg.at(-1), "zeff-claude:local");
  const fg = runArgs({ mounts: MOUNTS, foreground: true });
  assert.ok(fg.includes("--rm") && !fg.includes("-d"));
  // The config label changes with the mounts: a changed setting recreates the container.
  const label = (a: string[]) => a.find((x) => x.startsWith("zeff.config="));
  assert.notEqual(label(runArgs({ mounts: MOUNTS })), label(runArgs({ mounts: [...MOUNTS, { host: "D:\\Work", local: "/host/work" }] })));
  assert.equal(label(runArgs({ mounts: MOUNTS })), label(runArgs({ mounts: MOUNTS })));
});

test("the files of the image: Claude Code, git, a user that is not root, a health process", async () => {
  const dir = path.resolve(__dirname, "..", "docker", "claude");
  const docker = fs.readFileSync(path.join(dir, "Dockerfile"), "utf8");
  assert.match(docker, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /safe\.directory/);
  assert.match(fs.readFileSync(path.join(dir, "health.js"), "utf8"), /9335/);
});

test("the launcher: the Claude service is off by default; switched on it sets CLAUDE_CLI and the work host ends a run's claude in the container", async () => {
  const root = path.resolve(__dirname, "..");
  const config = fs.readFileSync(path.join(root, "launcher", "lib", "config.js"), "utf8");
  assert.match(config, /claudeDocker: false/);
  const main = fs.readFileSync(path.join(root, "launcher", "main.js"), "utf8");
  assert.match(main, /if \(cfg\.claudeDocker\) \{\s*env\.CLAUDE_CLI = claudeShim;/);
  assert.match(main, /new Service\(\{ \.\.\.spec\("Claude"/);
  const host = fs.readFileSync(path.join(root, "scripts", "work-host.mjs"), "utf8");
  assert.match(host, /killInContainer\(runId\);\s*killTree\(c\.pid\);/, "the shim's end on the host is not the claude's end in the container");
});
