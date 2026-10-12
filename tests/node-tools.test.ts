import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensurePortableNode, nodeLayout, npmInstall, pickNodeDist, type NodeRelease } from "@/lib/node-tools";

const index: NodeRelease[] = [
  { version: "v25.1.0", lts: false, files: ["win-x64-zip", "linux-x64"] },
  { version: "v22.20.0", lts: "Jod", files: ["win-x64-zip", "win-arm64-zip", "osx-arm64-tar", "linux-x64"] },
  { version: "v20.1.0", lts: "Iron", files: ["win-x64-zip"] },
];

test("the newest LTS release with a portable archive for this system is picked", () => {
  assert.equal(pickNodeDist(index, "win32", "x64")!.url, "https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip");
  assert.equal(pickNodeDist(index, "darwin", "arm64")!.url, "https://nodejs.org/dist/v22.20.0/node-v22.20.0-darwin-arm64.tar.gz");
  assert.equal(pickNodeDist(index, "linux", "x64")!.file, "node-v22.20.0-linux-x64.tar.gz");
  assert.equal(pickNodeDist(index, "darwin", "x64"), null);
});

test("Codex: the portable Node is downloaded and unpacked once, npm installs the package into Zeff's own prefix", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-tools-"));
  const calls: string[][] = [];
  let downloads = 0;
  const deps = {
    platform: "win32",
    arch: "x64",
    dir,
    fetchJson: async () => index,
    download: async (_url: string, to: string) => void (downloads++, fs.writeFileSync(to, "zip")),
    // "Unpacking" makes the folder a real release would have.
    run: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (command === "powershell") {
        const l = nodeLayout(path.join(dir, "node-v22.20.0-win-x64"), "win32");
        fs.mkdirSync(path.dirname(l.npm), { recursive: true });
        fs.writeFileSync(l.npm, "");
      }
      return { ok: true, out: "" };
    },
  };
  const r = await npmInstall("@openai/codex", deps);
  assert.ok(r.ok);
  assert.equal(downloads, 1);
  const npm = calls.find((c) => /npm-cli\.js$/.test(c[1] ?? ""))!;
  assert.deepEqual(npm.slice(2, 5), ["install", "-g", "@openai/codex"]);
  assert.equal(npm[npm.indexOf("--prefix") + 1], path.join(dir, "npm"));
  // Again: Node is there, not downloaded again.
  await ensurePortableNode(deps);
  assert.equal(downloads, 1);
});

test("a download or unpack that fails says why instead of throwing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-tools-"));
  const r = await npmInstall("@openai/codex", { platform: "win32", dir, fetchJson: async () => index, download: async () => { throw new Error("offline"); } });
  assert.equal(r.ok, false);
  assert.match(r.out, /offline/);
});
