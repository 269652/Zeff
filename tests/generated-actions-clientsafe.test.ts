import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * plugins/actions.generated.ts collects every `export const <NAME>_ACTIONS = [` in the plugin folders and is imported by
 * client code (the todo cards). A file it names must be client-safe: no database, no plugin state — a name like
 * `CHANNEL_ACTIONS` in a server module would pull better-sqlite3 into the browser bundle.
 */
test("the files actions.generated.ts imports hold no server-only imports", () => {
  const dir = path.join(process.cwd(), "src", "plugins");
  const gen = fs.readFileSync(path.join(dir, "actions.generated.ts"), "utf8");
  const files = [...gen.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((m) => path.join(dir, `${m[1]}.ts`));
  assert.ok(files.length > 5);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const bad = /from\s+["']@\/(db|plugins\/(state|ops)|lib\/prefs)["']/.exec(text);
    assert.equal(bad, null, `${path.relative(dir, f)} imports ${bad?.[0]} — rename its *_ACTIONS constant, or keep the module client-safe`);
  }
});
