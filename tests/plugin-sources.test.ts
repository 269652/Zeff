import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Plugins from a GitHub repository: one repository holds several (each folder with a zeff-plugin.json and its own version); Zeff lists
 * them against what is installed, installs one (switched off), updates it on a click merged with what was changed here — a file changed
 * only there is taken, one changed only here stays, one changed on both sides in different places is merged, the same lines changed on
 * both sides is a conflict that waits for the person; a file the new version dropped goes — and refuses what doesn't hold. The network
 * is a stand-in serving the repository's commits from memory.
 */

type Repo = Record<string, string>;
const commits: Record<string, Repo> = {};
let head = "c1";
const manifest = (id: string, version: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, name: id.toUpperCase(), version, apiVersion: 1, ...extra });

function serve() {
  return async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer });
    const miss = { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const raw = /^https:\/\/raw\.githubusercontent\.com\/me\/zeff-apps\/([^/]+)\/(.+)$/.exec(url);
    if (raw) {
      const repo = commits[raw[1]] ?? {};
      const file = decodeURIComponent(raw[2]);
      return file in repo ? ok(repo[file]) : miss;
    }
    if (url === "https://api.github.com/repos/me/zeff-apps") return ok({ default_branch: "main" });
    if (url === "https://api.github.com/repos/me/zeff-apps/commits/main") return ok({ sha: head });
    const tree = /^https:\/\/api\.github\.com\/repos\/me\/zeff-apps\/git\/trees\/([^?]+)/.exec(url);
    if (tree) return ok({ tree: Object.entries(commits[tree[1]] ?? {}).map(([p, c]) => ({ path: p, type: "blob", size: c.length })) });
    return miss;
  };
}
const publish = (sha: string, repo: Repo) => ((commits[sha] = repo), (head = sha));

test("a repository with several plugins: listed, one installed (off), updated merged with what you changed — a conflict waits for you", async () => {
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  src.setSourceFetcher(serve() as never);
  const lines = (...xs: string[]) => xs.join("\n") + "\n";
  publish("c1", {
    "README.md": "# apps",
    "apps/notes/zeff-plugin.json": manifest("notes", "1.0.0"),
    "apps/notes/fn/hello.js": "return 1;",
    "apps/notes/notes.md": lines("one", "two", "three", "four", "five", "six"),
    "apps/notes/old.txt": "goes in 1.1.0",
    "tools/calc/zeff-plugin.json": manifest("calc", "2.0.0"),
    "broken/zeff-plugin.json": "{ not json",
  });
  assert.throws(() => src.addSource("not an address"), /repository address/);
  const s = src.addSource("https://github.com/me/zeff-apps/");
  assert.equal(s.url, "https://github.com/me/zeff-apps");
  assert.throws(() => src.addSource("https://github.com/me/zeff-apps"), /already/);

  let st = await src.checkSource(s.id, { fresh: true });
  assert.equal(st.error, undefined);
  assert.deepEqual(st.plugins.map((p) => [p.id, p.version, p.path, p.installed]).sort(), [["calc", "2.0.0", "tools/calc", null], ["notes", "1.0.0", "apps/notes", null]]);
  assert.equal(st.problems.length, 1, "a folder whose manifest doesn't hold is said");

  const r1 = await src.installFromSource(s.id, "notes");
  assert.deepEqual([r1.from, r1.to, r1.conflicts], [null, "1.0.0", []]);
  const dir = path.join(reg.pluginsRoot(), "notes");
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hello.js"), "utf8"), "return 1;");
  assert.equal(reg.isEnabled("notes"), false, "installed from a source, it starts switched off");
  assert.equal(src.origin("notes")!.path, "apps/notes");

  // Here: the function changed, and the first line of the notes.
  fs.writeFileSync(path.join(dir, "fn", "hello.js"), "return 'mine';");
  fs.writeFileSync(path.join(dir, "notes.md"), lines("ONE (mine)", "two", "three", "four", "five", "six"));
  fs.writeFileSync(path.join(dir, "local.txt"), "made here");
  // 1.1.0 there: the function changed too, the last line of the notes, a new file, one gone.
  const v11: Repo = { ...commits.c1, "apps/notes/zeff-plugin.json": manifest("notes", "1.1.0"), "apps/notes/fn/hello.js": "return 2;", "apps/notes/notes.md": lines("one", "two", "three", "four", "five", "SIX (theirs)"), "apps/notes/new.txt": "new" };
  delete v11["apps/notes/old.txt"];
  publish("c2", v11);
  st = await src.checkSource(s.id, { fresh: true });
  const notes = st.plugins.find((p) => p.id === "notes")!;
  assert.deepEqual([notes.installed, notes.updateAvailable, notes.fromHere], ["1.0.0", true, true]);

  const r2 = await src.installFromSource(s.id, "notes");
  assert.deepEqual(r2.conflicts, ["fn/hello.js"], "the same line changed on both sides: a conflict");
  assert.deepEqual(r2.merged, ["notes.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hello.js"), "utf8"), "return 'mine';", "nothing written while a conflict is open");
  assert.ok(fs.existsSync(path.join(dir, "old.txt")));
  assert.equal(src.pendingMerge("notes")!.files.find((f) => f.rel === "fn/hello.js")!.markers!.includes("<<<<<<< mine"), true, "git's text with both sides");
  await assert.rejects(() => src.finishMerge("notes"), /Still open: fn\/hello\.js/);
  assert.equal((await src.checkSource(s.id)).plugins.find((p) => p.id === "notes")!.conflicts, 1);

  await src.settleConflict("notes", "fn/hello.js", "edited", "return 'mine' + 2;");
  const done = await src.finishMerge("notes");
  assert.equal(done.to, "1.1.0");
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hello.js"), "utf8"), "return 'mine' + 2;", "the text you settled on");
  assert.equal(fs.readFileSync(path.join(dir, "notes.md"), "utf8"), lines("ONE (mine)", "two", "three", "four", "five", "SIX (theirs)"), "both changes, merged");
  assert.ok(fs.existsSync(path.join(dir, "new.txt")));
  assert.ok(!fs.existsSync(path.join(dir, "old.txt")), "a file the new version dropped goes");
  assert.equal(fs.readFileSync(path.join(dir, "local.txt"), "utf8"), "made here", "a file made here stays");
  assert.equal(src.pendingMerge("notes"), null);
  assert.equal(reg.scanPlugins(true).plugins.find((p) => p.id === "notes")!.manifest.version, "1.1.0");
  assert.equal((await src.checkSource(s.id)).plugins.find((p) => p.id === "notes")!.updateAvailable, false);

  // 1.2.0 changes the function again: the text you settled on is yours (not 1.1.0's), so both sides changed it since — a conflict again.
  publish("c3", { ...commits.c2, "apps/notes/zeff-plugin.json": manifest("notes", "1.2.0"), "apps/notes/fn/hello.js": "return 3;" });
  const r3 = await src.installFromSource(s.id, "notes");
  assert.deepEqual(r3.conflicts, ["fn/hello.js"]);
  src.cancelMerge("notes");
  assert.equal(src.pendingMerge("notes"), null, "dropped: the plugin stays as it is");

  // A folder whose id changed is refused.
  publish("c4", { ...commits.c3, "apps/notes/zeff-plugin.json": manifest("other", "1.3.0") });
  await assert.rejects(() => src.installFromSource(s.id, "notes"), /no plugin “notes”|id changed/);
  src.setSourceFetcher(undefined);
});

test("a plugin names its own repository; a source can be removed (what came from it stays)", async () => {
  const src = await import("@/lib/ext/sources");
  const reg = await import("@/lib/ext/registry");
  const dir = path.join(reg.pluginsRoot(), "named");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zeff-plugin.json"), manifest("named", "1.0.0", { repository: { url: "https://github.com/me/named-plugin", path: "" } }));
  reg.scanPlugins(true);
  const named = src.listSources().find((s) => s.url === "https://github.com/me/named-plugin");
  assert.ok(named && named.id === "m:named");
  for (const s of src.listSources().filter((x) => !x.id.startsWith("m:"))) src.removeSource(s.id);
  assert.equal(src.listSources().filter((x) => !x.id.startsWith("m:")).length, 0);
  assert.ok(fs.existsSync(path.join(reg.pluginsRoot(), "notes", "zeff-plugin.json")), "plugins installed from it stay");
});
