import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
process.env.ZEFF_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-mod-feed-plugins-"));

/**
 * The bridge (lib/mods/feed.ts, docs/zeff-kernel.md stage 2): a patch to Zeff itself comes from a source like a plugin — but only as a
 * signed release, never unsigned or changed after signing. It is built and loaded at once (no rebuild of Zeff), named in the update
 * notes when a newer version is there, and your switch stays yours.
 */

type Repo = Record<string, string>;
const commits: Record<string, Repo> = {};
let head = "c1";
function serve() {
  return async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer });
    const miss = { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const raw = /^https:\/\/raw\.githubusercontent\.com\/zeff\/patches\/([^/]+)\/(.+)$/.exec(url);
    if (raw) {
      const repo = commits[raw[1]] ?? {};
      const file = decodeURIComponent(raw[2]);
      return file in repo ? ok(repo[file]) : miss;
    }
    if (url === "https://api.github.com/repos/zeff/patches") return ok({ default_branch: "main" });
    if (url === "https://api.github.com/repos/zeff/patches/commits/main") return ok({ sha: head });
    const tree = /^https:\/\/api\.github\.com\/repos\/zeff\/patches\/git\/trees\/([^?]+)/.exec(url);
    if (tree) return ok({ tree: Object.entries(commits[tree[1]] ?? {}).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) });
    return miss;
  };
}
const publish = (sha: string, repo: Repo) => ((commits[sha] = repo), (head = sha));

test("a signed patch installs, builds and works at once; unsigned or changed: refused; a newer one is an update note; your switch stays", async () => {
  await import("@/lib/ext/registry"); // (first: see tests/safe-mode.test.ts)
  const rel = await import("@/lib/kernel/release");
  const key = rel.makeReleaseKey();
  const keysFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeff-keys-")), "keys.json");
  fs.writeFileSync(keysFile, JSON.stringify({ "zeff-test": key.publicKeyPem }));
  process.env.ZEFF_RELEASE_KEYS = keysFile;

  const hook = await import("@/lib/mods/hook");
  const greet = hook.__zeffHook("t/feed#greet", (name: string) => `Hello ${name}`, "f1", "function");
  const patch = (version: string, suffix: string, signed = true): Repo => {
    const files: Record<string, string> = {
      "zeff-mod.json": JSON.stringify({ id: "greet-fix", name: "Greeting fix", version, description: "Fixes the greeting.", server: "server.ts", targets: { "t/feed#greet": "f1" } }),
      "server.ts": `import { mark } from "./mark";\nexport default (mod: any) => { mod.after("t/feed#greet", (r: string) => r + mark); };\n`,
      "mark.ts": `export const mark = ${JSON.stringify(suffix)};\n`,
    };
    const out: Repo = {};
    for (const [k, v] of Object.entries(files)) out[`patches/greet-fix/${k}`] = v;
    if (signed) out["patches/greet-fix/zeff-release.json"] = JSON.stringify(rel.signRelease("greet-fix", version, new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])), key.privateKeyPem, "zeff-test"));
    return out;
  };

  const src = await import("@/lib/ext/sources");
  const store = await import("@/lib/mods/store");
  src.setSourceFetcher(serve() as never);
  const s = src.addSource("https://github.com/zeff/patches");

  // Unsigned: never.
  publish("c0", patch("1.0.0", "!", false));
  const st = await src.checkSource(s.id, { fresh: true });
  assert.deepEqual(st.mods?.map((m) => [m.id, m.version, m.installed]), [["greet-fix", "1.0.0", null]]);
  await assert.rejects(src.installModFromSource(s.id, "greet-fix"), /only a signed release/);
  assert.equal(store.getMod("greet-fix"), null);
  // Changed after it was signed: never.
  const tampered = patch("1.0.0", "!");
  tampered["patches/greet-fix/mark.ts"] = `export const mark = " pwned";\n`;
  publish("c1", tampered);
  await assert.rejects(src.installModFromSource(s.id, "greet-fix"), /changed after/);

  // Signed: installed, built, loaded — it works at once.
  publish("c2", patch("1.0.0", "!"));
  const r = await src.installModFromSource(s.id, "greet-fix");
  assert.deepEqual([r.from, r.to, r.problems], [null, "1.0.0", []]);
  const m = store.getMod("greet-fix")!;
  assert.equal(m.state.enabled, true, "you clicked Install: it is on");
  assert.equal(m.state.from?.key, "zeff-test");
  assert.equal(greet("Ann"), "Hello Ann!");

  // A newer version: an update note "mod:greet-fix".
  publish("c3", patch("1.1.0", "!!"));
  const { checkForUpdates } = await import("@/lib/ext/packages-sync");
  const notes = await checkForUpdates();
  assert.ok(notes.some((n) => n.id === "mod:greet-fix" && n.from === "1.0.0" && n.to === "1.1.0"));

  // You switched it off: the update keeps it off.
  store.setModState("greet-fix", { enabled: false });
  (await import("@/lib/mods/server")).loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann");
  await src.installModFromSource(s.id, "greet-fix");
  assert.equal(store.getMod("greet-fix")!.manifest.version, "1.1.0");
  assert.equal(store.getMod("greet-fix")!.state.enabled, false);
  store.setModState("greet-fix", { enabled: true });
  (await import("@/lib/mods/server")).loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann!!");
  assert.ok(store.modVersions("greet-fix").length >= 1, "the version before is kept");

  // Safe mode: no patch either.
  const sm = await import("@/lib/kernel/safe-mode");
  sm.setSafeMode(true);
  (await import("@/lib/mods/server")).loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann");
  sm.setSafeMode(false);
  (await import("@/lib/mods/server")).loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann!!");
});
