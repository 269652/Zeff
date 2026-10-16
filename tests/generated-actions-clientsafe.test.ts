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

/**
 * The same, through what those files import in turn: a `*_ACTIONS` constant in a module that imports the Workspace's store (which
 * opens the database) pulls better-sqlite3 into the browser bundle just as well — the whole app then fails to compile.
 */
test("nothing actions.generated.ts reaches imports the database, even through other modules", () => {
  const src = path.join(process.cwd(), "src");
  const dir = path.join(src, "plugins");
  const gen = fs.readFileSync(path.join(dir, "actions.generated.ts"), "utf8");
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(c)) return c;
    return null;
  };
  const seen = new Set<string>();
  const trail = new Map<string, string>();
  const queue = [...gen.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((m) => resolve(path.join(dir, "x.ts"), m[1])).filter((f): f is string => !!f);
  let hit: string | null = null;
  while (queue.length && !hit) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      if (m[1] === "@/db" || m[1] === "better-sqlite3") hit = `${path.relative(src, f)} imports ${m[1]}`;
      const next = resolve(f, m[1]);
      if (next && !seen.has(next)) {
        trail.set(next, f);
        queue.push(next);
      }
    }
  }
  assert.equal(hit, null, `${hit} — reached from actions.generated.ts: rename the *_ACTIONS constant of the first server module on the way (e.g. ..._KINDS)`);
});
