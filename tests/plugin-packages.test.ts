import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Plugins from a git repository on this computer (like ../zeff-plugins), followed through packages.json: what it lists is installed from
 * the place it names, a plugin moved to another repository is reinstalled from there, a newer commit becomes an update note with the
 * commits since your version, and the update is merged with what was changed here. A real git repository in a temporary folder.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", ...args], { cwd, stdio: "pipe" }).toString();
const manifest = (id: string, version: string) => JSON.stringify({ id, name: id, version, apiVersion: 1 }, null, 2);

function makeRepo(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  commit(dir, files, "first");
  return dir;
}
function commit(dir: string, files: Record<string, string | null>, msg: string) {
  for (const [f, c] of Object.entries(files)) {
    const at = path.join(dir, f);
    if (c === null) fs.rmSync(at, { force: true });
    else (fs.mkdirSync(path.dirname(at), { recursive: true }), fs.writeFileSync(at, c));
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

test("packages.json followed: listed plugins installed from a local git repository, moved ones reinstalled, updates noted and merged", async () => {
  process.env.ZEFF_PACKAGES_FILE = path.join(tmp, "packages.json");
  const reg = await import("@/lib/ext/registry");
  const pf = await import("@/lib/ext/packages-file");
  const sync = await import("@/lib/ext/packages-sync");
  const src = await import("@/lib/ext/sources");

  const a = makeRepo("zeff-plugins", { "plugins/hello/zeff-plugin.json": manifest("hello", "1.0.0"), "plugins/hello/fn/hi.js": "line1\nline2\nline3\nline4\n" });
  assert.equal(await sync.applyPackagesFile(), null, "no packages.json: nothing to follow");

  // A file that doesn't hold is said, not followed.
  fs.writeFileSync(pf.packagesFilePath(), JSON.stringify({ sources: {}, plugins: { hello: { source: "nowhere" } } }));
  assert.match((await sync.applyPackagesFile())!.error!, /names no source/);

  pf.writePackagesFile({ sources: { "zeff-plugins": { url: a } }, plugins: { hello: { source: "zeff-plugins", path: "plugins/hello" } } });
  let st = await sync.applyPackagesFile();
  assert.deepEqual(st!.results.map((r) => [r.id, r.outcome, r.to]), [["hello", "installed", "1.0.0"]]);
  const dir = path.join(reg.pluginsRoot(), "hello");
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hi.js"), "utf8"), "line1\nline2\nline3\nline4\n");
  assert.equal(src.origin("hello")!.url, a);
  assert.equal((await sync.applyPackagesFile())!.results[0].outcome, "installed", "the same file is not followed twice (its last result stands)");
  assert.equal((await sync.applyPackagesFile({ force: true }))!.results[0].outcome, "same", "asked again: nothing to do");

  // Changed here, and a new version published there (another line): an update note with the commit, merged on Update.
  fs.writeFileSync(path.join(dir, "fn", "hi.js"), "line1 (mine)\nline2\nline3\nline4\n");
  commit(a, { "plugins/hello/zeff-plugin.json": manifest("hello", "1.1.0"), "plugins/hello/fn/hi.js": "line1\nline2\nline3\nline4 (theirs)\n" }, "hello: a better last line");
  commit(a, { "README.md": "not the plugin's" }, "unrelated");
  const notes = await sync.checkForUpdates();
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].id, notes[0].from, notes[0].to], ["hello", "1.0.0", "1.1.0"]);
  assert.deepEqual(notes[0].notes.map((n) => n.subject), ["hello: a better last line"], "only the commits that touched the plugin");
  assert.equal(sync.storedUpdates().updates.length, 1);
  sync.putOff("hello", "1.1.0");
  assert.equal(sync.storedUpdates().updates.length, 0, "later: not offered again for this version");
  const r = await src.installFromSource(notes[0].sourceId, "hello");
  assert.deepEqual([r.to, r.merged, r.conflicts], ["1.1.0", ["fn/hi.js"], []]);
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hi.js"), "utf8"), "line1 (mine)\nline2\nline3\nline4 (theirs)\n");
  sync.rememberInPackages("hello");
  // A commit to another folder of the repository: no update for this plugin (same version, its folder untouched).
  commit(a, { "plugins/other/readme.md": "another plugin's" }, "another plugin");
  assert.deepEqual(await sync.checkForUpdates(), [], "a commit elsewhere in the repository is no update of it");
  // A fix in its folder without a new version number: an update all the same.
  commit(a, { "plugins/hello/notes.txt": "a fix" }, "hello: a fix, same version");
  assert.deepEqual((await sync.checkForUpdates()).map((n) => [n.id, n.from, n.to, n.notes.map((x) => x.subject)]), [["hello", "1.1.0", "1.1.0", ["hello: a fix, same version"]]]);
  await src.installFromSource((await sync.checkForUpdates())[0].sourceId, "hello");

  // The plugin moved to another repository in packages.json: reinstalled from there — merged against the version installed from the old one.
  const b = makeRepo("other-plugins", { "hello/zeff-plugin.json": manifest("hello", "2.0.0"), "hello/fn/hi.js": "line1 (mine)\nline2\nline3\nline4 (theirs)\n", "hello/extra.md": "more" });
  pf.writePackagesFile({ sources: { "zeff-plugins": { url: a }, other: { url: b } }, plugins: { hello: { source: "other" } } });
  st = await sync.applyPackagesFile();
  assert.deepEqual(st!.results.map((x) => [x.id, x.outcome, x.to]), [["hello", "reinstalled", "2.0.0"]]);
  assert.equal(src.origin("hello")!.url, b);
  assert.equal(src.origin("hello")!.path, "hello");
  assert.ok(fs.existsSync(path.join(dir, "extra.md")));
  assert.equal(fs.readFileSync(path.join(dir, "fn", "hi.js"), "utf8"), "line1 (mine)\nline2\nline3\nline4 (theirs)\n", "the same text: no conflict");
  delete process.env.ZEFF_PACKAGES_FILE;
});

test("a three-way merge of one file: theirs, mine, both merged, a conflict, gone", async () => {
  const { planFile } = await import("@/lib/ext/merge3");
  const B = (s: string | null) => (s === null ? null : Buffer.from(s));
  assert.equal((await planFile("a", B("x"), B("x"), B("y"))).outcome, "take");
  assert.equal((await planFile("a", B("x"), B("m"), B("x"))).outcome, "keep");
  assert.equal((await planFile("a", B("x"), B("x"), null)).outcome, "delete");
  assert.equal((await planFile("a", B("x"), B("m"), null)).outcome, "conflict", "deleted there, changed here");
  assert.equal((await planFile("a", null, null, B("n"))).outcome, "add");
  const merged = await planFile("a", B("1\n2\n3\n4\n"), B("1m\n2\n3\n4\n"), B("1\n2\n3\n4t\n"));
  assert.equal(merged.outcome, "merged");
  assert.equal(Buffer.from(merged.result!, "base64").toString(), "1m\n2\n3\n4t\n");
  const c = await planFile("a", B("1\n"), B("mine\n"), B("theirs\n"));
  assert.equal(c.outcome, "conflict");
  assert.match(c.markers!, /<<<<<<< mine[\s\S]*\|\|\|\|\|\|\| base[\s\S]*=======[\s\S]*>>>>>>> theirs/);
});
