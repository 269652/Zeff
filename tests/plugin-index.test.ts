import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderActions, renderLlmTasks, renderManifests, renderServer } from "../src/lib/plugins/index-gen";
import { CORE_PLUGIN_IDS, PLUGINS, STEP_NEEDS } from "../src/plugins/catalog";

const dir = path.join(process.cwd(), "src", "plugins");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

/** The plugin list is generated from the folders: a plugin added or removed without `npm run plugins:index` fails here. */
test("the generated plugin indexes are fresh", () => {
  assert.equal(read("index.generated.ts"), renderManifests(), "run `npm run plugins:index`");
  assert.equal(read("server.generated.ts"), renderServer(), "run `npm run plugins:index`");
  assert.equal(read("actions.generated.ts"), renderActions(), "run `npm run plugins:index`");
  assert.equal(read("llm-tasks.generated.ts"), renderLlmTasks(), "run `npm run plugins:index`");
});

/** Each plugin's manifest is in the folder named like its id, and everything it names exists. */
test("manifests are consistent: ids, folders, dependencies, extensions", () => {
  const ids = new Set<string>(PLUGINS.map((p) => p.id));
  assert.equal(ids.size, PLUGINS.length, "an id is used twice");
  for (const p of PLUGINS) {
    assert.ok(fs.existsSync(path.join(dir, p.id, "plugin.ts")), `${p.id}: plugin.ts is not in a folder named like it`);
    for (const d of p.dependsOn ?? []) assert.ok(ids.has(d), `${p.id} depends on unknown "${d}"`);
    assert.ok(!p.dependsOn?.includes(p.id), `${p.id} depends on itself`);
    for (const e of p.extensions ?? []) {
      assert.ok(ids.has(e.for), `${p.id}:${e.key} extends unknown "${e.for}"`);
      for (const r of e.requires ?? []) assert.ok(ids.has(r), `${p.id}:${e.key} requires unknown "${r}"`);
    }
  }
  for (const [step, needs] of Object.entries(STEP_NEEDS)) for (const n of needs.flat()) assert.ok(ids.has(n), `step ${step} needs unknown "${n}"`);
});

/** Zeff's own plugins have an `order` each, distinct (a stable, intended menu order); a mounted integration's come after them. */
test("plugins have distinct orders", () => {
  const core = PLUGINS.filter((p) => CORE_PLUGIN_IDS.includes(p.id));
  const orders = core.map((p) => p.order);
  assert.ok(orders.every((o) => typeof o === "number"), "a plugin without an order");
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual(orders, [...orders].sort((a, b) => a! - b!));
});
