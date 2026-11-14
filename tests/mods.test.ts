import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Mods (docs/mods.md): the build puts every exported function and component behind a named hook (scripts/mods/analyze.cjs); a mod
 * registers before / after / around / replace on those names; whatever a mod breaks is passed by, a mod that keeps failing is switched
 * off, a hook written for older code is held back; a mod is built by esbuild and loaded at runtime, no rebuild of Zeff.
 */

const require = createRequire(import.meta.url);
const { analyze, transform } = require("../scripts/mods/analyze.cjs") as { analyze: (rel: string, code: string) => { skip?: string; points: { id: string; kind: string; async: boolean; hash: string }[] }; transform: (rel: string, code: string) => string };

test("the build: exported functions and components get named hooks — the rest stays as it was", () => {
  const code = `"use client";
import x from "y";
export function Card(props: { a: number }) { return props.a; }
export async function load(id: number) { return id; }
export const helper = (a: number) => a + 1;
export const VALUE = 3;
export function over(a: string): string;
export function over(a: unknown) { return a; }
export default function Page() { return null; }
export async function generateMetadata() { return {}; }
export class Thing {}
`;
  const a = analyze("plugins/x/ui/card.tsx", code);
  assert.deepEqual(a.points.map((p) => [p.id, p.kind, p.async]), [
    ["plugins/x/ui/card#Card", "component", false],
    ["plugins/x/ui/card#load", "function", true],
    ["plugins/x/ui/card#helper", "function", false],
    ["plugins/x/ui/card#over", "function", false],
    ["plugins/x/ui/card#Page", "component", false],
  ]);
  const out = transform("plugins/x/ui/card.tsx", code);
  assert.ok(out.startsWith('"use client";'), "the directive stays first");
  assert.match(out, /export let\s+helper = /);
  assert.match(out, /export const VALUE = 3;/);
  assert.match(out, /Card = __zeffHook__\("plugins\/x\/ui\/card#Card", Card, "[0-9a-f]{12}", "component"\);/);
  assert.doesNotMatch(out, /generateMetadata = __zeffHook__/);
  // A changed function: another hash (a mod written for the old one is held back).
  const h1 = analyze("a.ts", "export function f() { return 1; }").points[0].hash;
  const h2 = analyze("a.ts", "export function f() { return 2; }").points[0].hash;
  assert.notEqual(h1, h2);
  // Files Next compiles itself, and the runtime: no hooks.
  assert.equal(analyze("app/actions.ts", '"use server";\nexport async function save() {}').points.length, 0);
  assert.equal(analyze("lib/mods/hook.ts", "export function x() {}").points.length, 0);
  assert.equal(transform("proxy.ts", "export function proxy() {}"), "export function proxy() {}");
});

test("the hooks: before / after / around / replace in order; what a mod breaks is passed by; 5 failures switch it off; old code holds a hook back", async () => {
  const hook = await import("@/lib/mods/hook");
  const add = hook.__zeffHook("t/math#add", (a: number, b: number) => a + b, "h1", "function");
  const slow = hook.__zeffHook("t/math#slow", async (a: number) => a * 2, "h2", "function");
  assert.equal(add(1, 2), 3, "no mod: the original");
  hook.setModParts([
    {
      mod: "m1",
      part: "server",
      setup: () => (api) => {
        api.before("t/math#add", (args) => [Number(args[0]) * 10, args[1]]);
        api.after("t/math#add", (r) => Number(r) + 1);
        api.after("t/math#slow", (r) => Number(r) + 1);
      },
    },
    { mod: "m2", part: "server", setup: () => (api) => api.around("t/math#add", (next, a, b) => Number(next(a, b)) * 2) },
  ]);
  // m1 outermost: before 1→10; m2 around: (10+2)*2 = 24; m1 after: 25.
  assert.equal(add(1, 2), 25);
  assert.equal(await slow(2), 5, "after waits for an async result");

  // A failing hook is passed by: the original's result stands.
  hook.setModParts([{ mod: "bad", part: "server", setup: () => (api) => api.after("t/math#add", () => { throw new Error("boom"); }) }]);
  assert.equal(add(1, 2), 3);
  const G = hook.modsGlobal();
  assert.equal(G.errors.at(-1)!.mod, "bad");
  for (let i = 0; i < 5; i++) add(1, 2);
  assert.ok(G.disabled.has("bad"), "a mod that keeps failing is switched off");
  // An around that throws before calling next: the original runs; after: its result is kept (it never runs twice).
  let runs = 0;
  const count = hook.__zeffHook("t/count#inc", () => ++runs, "h3", "function");
  hook.setModParts([{ mod: "half", part: "server", setup: () => (api) => api.around("t/count#inc", (next) => { next(); throw new Error("after"); }) }]);
  assert.equal(count(), 1);
  assert.equal(runs, 1, "the original ran once");
  // Written for older code: held back.
  hook.setModParts([{ mod: "old", part: "server", targets: { "t/math#add": "OLDHASH" }, setup: () => (api) => api.replace("t/math#add", () => 99) }]);
  assert.equal(add(1, 2), 3);
  assert.ok([...G.stale.values()].some((s) => s.mod === "old" && s.hook === "t/math#add"));
  hook.setModParts([{ mod: "now", part: "server", targets: { "t/math#add": "h1" }, setup: () => (api) => api.replace("t/math#add", () => 99) }]);
  assert.equal(add(1, 2), 99);
  // Safe mode: no mod.
  G.safe = true;
  hook.setModParts(G.parts);
  assert.equal(add(1, 2), 3);
  G.safe = false;
  hook.setModParts([]);
  // Not a function: left as it is.
  assert.equal(hook.__zeffHook("t/x#v", 5, "h", "function"), 5);
  class K {}
  assert.equal(hook.__zeffHook("t/x#K", K, "h", "function"), K);
});

test("a mod: written, built by esbuild, loaded at runtime — on only when switched on; the AI's change switches it off", async () => {
  const store = await import("@/lib/mods/store");
  const build = await import("@/lib/mods/build");
  const server = await import("@/lib/mods/server");
  const hook = await import("@/lib/mods/hook");
  const greet = hook.__zeffHook("t/greet#greet", (name: string) => `Hello ${name}`, "g1", "function");
  const files = {
    "server.ts": `import { suffix } from "./util";\nimport fs from "node:fs";\nexport default (mod: any) => {\n  mod.after("t/greet#greet", (r: string) => r + suffix + (typeof fs.existsSync === "function" ? "" : "?"));\n};\n`,
    "util.ts": `export const suffix = "!";\n`,
  };
  // (util.ts is a file of its folder, bundled with it — written beside)
  store.writeMod({ id: "greeter", name: "Greeter", version: "1.0.0", description: "Shouts.", server: "server.ts" }, { "server.ts": files["server.ts"] }, "you");
  fs.writeFileSync(path.join(store.modDir("greeter"), "util.ts"), files["util.ts"]);
  const b = await build.buildMod("greeter");
  assert.deepEqual(b.problems, []);
  assert.equal(server.loadMods(true).length, 0);
  assert.equal(greet("Ann"), "Hello Ann", "off: nothing");
  store.setModState("greeter", { enabled: true });
  server.loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann!");
  // A part that doesn't build: said, and the mod is off.
  store.writeMod({ id: "broken", name: "Broken", version: "1.0.0", description: "", server: "server.ts" }, { "server.ts": "import x from 'left-pad';\nexport default () => { console.log(x); };" }, "you");
  const bad = await build.buildMod("broken");
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(" "), /brings its own code/);
  // The AI changes the greeter: switched off until you look; the version before is kept.
  store.writeMod({ id: "greeter", name: "Greeter", version: "1.1.0", description: "Shouts more.", server: "server.ts" }, { "server.ts": files["server.ts"].replace('r + suffix', 'r + suffix + suffix') }, "ai");
  assert.equal(store.modState("greeter").enabled, false);
  assert.match(store.modState("greeter").disabledReason ?? "", /AI/);
  assert.equal(store.modVersions("greeter").length, 1);
  server.loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann");
  // Safe mode: nothing, even when on.
  store.setModState("greeter", { enabled: true });
  await build.buildMod("greeter");
  store.setSafeMode(true);
  server.loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann");
  store.setSafeMode(false);
  server.loadMods(true);
  assert.equal(greet("Ann"), "Hello Ann!!");
  // Back to the version before (switched off until you switch it on).
  store.restoreModVersion("greeter", store.modVersions("greeter").at(-1)!.id);
  assert.equal(store.getMod("greeter")!.manifest.version, "1.0.0");
  assert.equal(store.modState("greeter").enabled, false);
});

test("a mod for some accounts runs only in calls made for them; the hooks know their components' names", async () => {
  const hook = await import("@/lib/mods/hook");
  const G = hook.modsGlobal();
  const before = G.account;
  let now = "private";
  G.account = () => now;
  const shout = hook.__zeffHook("t/acc#shout", (s: string) => s, "a1", "function");
  hook.setModParts([{ mod: "work-only", part: "server", accounts: ["work"], setup: () => (api) => api.after("t/acc#shout", (r) => `${r}!`) }]);
  assert.equal(shout("hi"), "hi", "another account: as it was");
  now = "work";
  assert.equal(shout("hi"), "hi!", "its account: changed");
  hook.setModParts([{ mod: "all", part: "server", setup: () => (api) => api.after("t/acc#shout", (r) => `${r}?`) }]);
  now = "private";
  assert.equal(shout("hi"), "hi?", "a mod for every account: everywhere");
  hook.setModParts([]);
  G.account = before;
  // What is under the pointer: a hooked component is known by its hook's name (lib/mods/pick.ts).
  const Card = hook.__zeffHook("t/ui/card#Card", function Card() { return null; }, "c1", "component");
  assert.equal(hook.hookIdOf(Card), "t/ui/card#Card");
  assert.equal(hook.hookIdOf(() => null), null);
});

test("held back from the catalog: a hook whose code changed or is gone, before any call", async () => {
  const store = await import("@/lib/mods/store");
  const catalog = new Map([["a/x#f", "same"], ["a/x#g", "new"]]);
  const m = store.normalizeManifest({ id: "cat-check", targets: { "a/x#f": "same", "a/x#g": "old", "a/x#gone": "h" } });
  assert.deepEqual(store.staleTargets(m, catalog), ["a/x#g", "a/x#gone"]);
});

test("Undo of an AI answer takes a mod back: a new one is moved aside, a changed one goes back to its version (and on, if it was)", async () => {
  const store = await import("@/lib/mods/store");
  const undo = await import("@/plugins/workspace/undo");
  const files = { "server.ts": "export default () => {};\n" };
  // A new mod, made by an answer: Undo moves it aside.
  const made = await undo.undoable("AI chat: a mod", () => store.writeMod({ id: "undo-new", name: "New", server: "server.ts" }, files, "ai"), "ai");
  assert.ok(made.undoId, "the answer is one entry of the history");
  assert.ok(store.getMod("undo-new"));
  await undo.undo(made.undoId!);
  assert.equal(store.getMod("undo-new"), null);
  assert.ok(fs.readdirSync(path.join(store.modsRoot(), ".removed")).some((d) => d.startsWith("undo-new-")), "moved aside, not deleted");
  // A mod that was on, changed by an answer (twice — the state before the whole answer counts): Undo brings that back, and on.
  store.writeMod({ id: "undo-old", name: "Old", version: "1.0.0", server: "server.ts" }, files, "you");
  store.setModState("undo-old", { enabled: true });
  const changed = await undo.undoable("AI chat: change it", async () => {
    store.writeMod({ id: "undo-old", name: "Old", version: "2.0.0", server: "server.ts" }, files, "ai");
    store.writeMod({ id: "undo-old", name: "Old", version: "3.0.0", server: "server.ts" }, files, "ai");
  }, "ai");
  assert.equal(store.modState("undo-old").enabled, false, "the AI's change: off");
  await undo.undo(changed.undoId!);
  assert.equal(store.getMod("undo-old")!.manifest.version, "1.0.0");
  assert.equal(store.modState("undo-old").enabled, true, "on again, as it was");
});
