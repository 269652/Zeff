import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
process.env.ZEFF_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-release-plugins-"));

/**
 * Signed releases (lib/kernel/release.ts): what a repository serves is installed only when its files match the signature of a key the
 * kernel knows — or when it isn't signed at all (as before: switched off, granted by you). A file changed, added or missing after
 * signing, another key, a forged signature: refused. A plugin installed signed is never updated unsigned.
 */

type Repo = Record<string, string>;
const commits: Record<string, Repo> = {};
let head = "c1";
function serve() {
  return async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer });
    const miss = { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const raw = /^https:\/\/raw\.githubusercontent\.com\/zeff\/feed\/([^/]+)\/(.+)$/.exec(url);
    if (raw) {
      const repo = commits[raw[1]] ?? {};
      const file = decodeURIComponent(raw[2]);
      return file in repo ? ok(repo[file]) : miss;
    }
    if (url === "https://api.github.com/repos/zeff/feed") return ok({ default_branch: "main" });
    if (url === "https://api.github.com/repos/zeff/feed/commits/main") return ok({ sha: head });
    const tree = /^https:\/\/api\.github\.com\/repos\/zeff\/feed\/git\/trees\/([^?]+)/.exec(url);
    if (tree) return ok({ tree: Object.entries(commits[tree[1]] ?? {}).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) });
    return miss;
  };
}
const publish = (sha: string, repo: Repo) => ((commits[sha] = repo), (head = sha));

async function kit() {
  const rel = await import("@/lib/kernel/release");
  const key = rel.makeReleaseKey();
  const other = rel.makeReleaseKey();
  const keysFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeff-keys-")), "keys.json");
  fs.writeFileSync(keysFile, JSON.stringify({ "zeff-test": key.publicKeyPem }));
  process.env.ZEFF_RELEASE_KEYS = keysFile;
  /** A plugin folder as a repository serves it, signed (or not) — its files under plugins/films/. */
  const folder = (version: string, extra: Record<string, string> = {}, sign: { pem: string; name: string } | null = { pem: key.privateKeyPem, name: "zeff-test" }): Repo => {
    const files: Record<string, string> = { "zeff-plugin.json": JSON.stringify({ id: "films", name: "Films", version, apiVersion: 1 }), "fn/list.js": `return "${version}";`, ...extra };
    const out: Repo = {};
    for (const [k, v] of Object.entries(files)) out[`plugins/films/${k}`] = v;
    if (sign) out["plugins/films/zeff-release.json"] = JSON.stringify(rel.signRelease("films", version, new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])), sign.pem, sign.name));
    return out;
  };
  return { rel, key, other, folder };
}

test("the check: signed and whole; changed, added, missing, another key, forged — refused; none — unsigned", async () => {
  const { rel, key, other } = await kit();
  const files = new Map([["zeff-plugin.json", Buffer.from("{}")], ["a.js", Buffer.from("1")]]);
  const release = rel.signRelease("films", "1.0.0", files, key.privateKeyPem, "zeff-test");
  const withRelease = (m: Map<string, Buffer>, r: unknown = release) => new Map([...m, ["zeff-release.json", Buffer.from(JSON.stringify(r))]]);
  const want = { id: "films", version: "1.0.0" };
  assert.deepEqual(rel.checkRelease(withRelease(files), want), { status: "signed", key: "zeff-test" });
  assert.deepEqual(rel.checkRelease(files, want), { status: "unsigned" });
  const bad = (m: Map<string, Buffer>, r?: unknown, w = want) => {
    const c = rel.checkRelease(withRelease(m, r), w);
    return c.status === "bad" ? c.reason : c.status;
  };
  assert.match(bad(new Map([...files, ["a.js", Buffer.from("2")]])), /changed after/);
  assert.match(bad(new Map([...files, ["b.js", Buffer.from("x")]])), /not part of the release/);
  assert.match(bad(new Map([["zeff-plugin.json", Buffer.from("{}")]])), /missing/);
  assert.match(bad(files, rel.signRelease("films", "1.0.0", files, other.privateKeyPem, "stranger")), /doesn't know/);
  assert.match(bad(files, rel.signRelease("films", "1.0.0", files, other.privateKeyPem, "zeff-test")), /signature doesn't match/);
  assert.match(bad(files, { ...release, files: { ...release.files, "a.js": "0".repeat(64) } }), /signature doesn't match/);
  assert.match(bad(files, release, { id: "films", version: "2.0.0" }), /release is of/);
});

test("from a repository: signed installs; a forged update is refused; once signed, never unsigned again", async () => {
  const { other, folder } = await kit();
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  src.setSourceFetcher(serve() as never);
  const s = src.addSource("https://github.com/zeff/feed");

  publish("c1", folder("1.0.0"));
  await src.installFromSource(s.id, "films");
  assert.equal(src.origin("films")!.signed, "zeff-test");
  const dir = path.join(reg.pluginsRoot(), "films");
  assert.equal(fs.readFileSync(path.join(dir, "fn", "list.js"), "utf8"), 'return "1.0.0";');

  // Someone with push access changes a file after it was signed.
  const tampered = folder("1.1.0");
  tampered["plugins/films/fn/list.js"] = "steal();";
  publish("c2", tampered);
  await assert.rejects(src.installFromSource(s.id, "films"), /changed after the release was signed/);
  // Signed by a key the kernel doesn't know.
  publish("c3", folder("1.1.0", {}, { pem: other.privateKeyPem, name: "stranger" }));
  await assert.rejects(src.installFromSource(s.id, "films"), /doesn't know/);
  // Not signed at all: a plugin that was signed stays as it is.
  publish("c4", folder("1.1.0", {}, null));
  await assert.rejects(src.installFromSource(s.id, "films"), /not signed/);
  assert.equal(fs.readFileSync(path.join(dir, "fn", "list.js"), "utf8"), 'return "1.0.0";', "nothing was written");

  // The real 1.1.0.
  publish("c5", folder("1.1.0", { "fn/more.js": "return 2;" }));
  const r = await src.installFromSource(s.id, "films");
  assert.equal(r.to, "1.1.0");
  assert.equal(fs.readFileSync(path.join(dir, "fn", "list.js"), "utf8"), 'return "1.1.0";');
});

test("a plugin that was never signed installs and updates as before (switched off)", async () => {
  const { folder } = await kit();
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  src.setSourceFetcher(serve() as never);
  const s = src.listSources().find((x) => x.url === "https://github.com/zeff/feed") ?? src.addSource("https://github.com/zeff/feed");
  fs.rmSync(path.join(reg.pluginsRoot(), "films"), { recursive: true, force: true });
  fs.rmSync(path.join(reg.pluginsRoot(), ".origin", "films.json"), { force: true });
  publish("u1", folder("3.0.0", {}, null));
  await src.installFromSource(s.id, "films");
  assert.equal(src.origin("films")!.signed, undefined);
  assert.equal(reg.isEnabled("films"), false);
});
