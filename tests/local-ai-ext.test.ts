import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Local AI's port (zeff-plugins/plugins/local-ai-ext): its settings page as a block of the view language — drawn without an error in every
 * state (loading, a server that answers, none), its buttons doing the kernel's actions as the built-in's did — and those actions: the
 * settings read and saved (an address checked), what answers at an address (with the model choices), the port providing its built-in.
 */

const DIR = path.resolve("../zeff-plugins/plugins/local-ai-ext");
const have = fs.existsSync(path.join(DIR, "settings.html"));
const NOW = new Date("2026-11-14T12:00:00");

async function draw(state: Record<string, string>, data: Record<string, unknown>) {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const template = fs.readFileSync(path.join(DIR, "settings.html"), "utf8");
  return renderView(template, { rows: [], props: [], titleName: "Name", state, app: {}, data, db: { id: 1, title: "Local AI" }, now: NOW, locale: "de-DE" } as never, { parts: [], actions: [] });
}
const find = (nodes: unknown[], tag: string): { t: string; a: Record<string, string> }[] =>
  (nodes as ({ t: string; a: Record<string, string>; c: unknown[] } | string)[]).flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));

const CFG = { url: "http://127.0.0.1:11434", model: "", secretLocal: true, presets: [{ label: "Ollama", url: "http://127.0.0.1:11434" }, { label: "LM Studio", url: "http://127.0.0.1:1234" }] };

test("the settings block draws in every state, its buttons do the kernel's actions", { skip: !have && "zeff-plugins isn't beside Zeff" }, async () => {
  for (const [state, data] of [
    [{}, {}],
    [{}, { cfg: CFG }],
    [{ url: CFG.url }, { cfg: CFG, probe: { ok: false, kind: null, models: [], choices: [], error: "Nothing answers" } }],
    [{ url: CFG.url, model: "qwen3:8b" }, { cfg: CFG, probe: { ok: true, kind: "ollama", models: ["qwen3:8b", "llama3:8b"], choices: [["", "The first one (qwen3:8b)"], ["qwen3:8b", "qwen3:8b"], ["llama3:8b", "llama3:8b"]], error: null } }],
  ] as [Record<string, string>, Record<string, unknown>][]) {
    const r = await draw(state, data);
    assert.deepEqual(r.errors, [], JSON.stringify(state) + JSON.stringify(data).slice(0, 60));
  }
  const r = await draw({ url: CFG.url, model: "qwen3:8b", secret: "true" }, { cfg: CFG, probe: { ok: true, kind: "ollama", models: ["qwen3:8b"], choices: [["", "The first one (qwen3:8b)"], ["qwen3:8b", "qwen3:8b"]], error: null } });
  const select = find(r.nodes, "select")[0];
  assert.deepEqual(JSON.parse(select.a.options).map((o: string[]) => o[0]), ["", "qwen3:8b"], "a model with a colon is one option");
  const buttons = find(r.nodes, "button");
  assert.deepEqual(JSON.parse(buttons.find((b) => b.a.do === "localai.save")!.a.with), { url: CFG.url, model: "qwen3:8b", secretLocal: true });
  assert.deepEqual(JSON.parse(buttons.find((b) => b.a.do === "localai.test")!.a.with), { url: CFG.url, model: "qwen3:8b" });
  assert.deepEqual(buttons.filter((b) => b.a.action === "state").map((b) => [b.a.value, b.a.variant]), [[CFG.url, "primary"], ["http://127.0.0.1:1234", "plain"]], "the preset in use is marked");
  const data = find(r.nodes, "data");
  assert.ok(data.some((d) => d.a.do === "localai.probe" && JSON.parse(d.a.with).url === CFG.url));
});

test("the kernel's local AI actions: settings read and saved (the address checked), nothing answering said", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "llm"]) setInstalled(id as never, true);
  await import("@/plugins/contributions");
  const { flowAction } = await import("@/plugins/workspace/flows/actions");
  const ctx = { flow: "test", runId: null, dryRun: false, perms: {}, web: async (u: string) => new URL(u), canWrite: () => undefined, may: () => undefined, log: () => undefined };
  const cfg = (await flowAction("localai.config")!.run({}, ctx)) as { url: string; presets: unknown[] };
  assert.equal(cfg.url, "http://127.0.0.1:11434");
  assert.equal(cfg.presets.length, 2);
  const saved = (await flowAction("localai.save")!.run({ url: "http://127.0.0.1:1234/v1/", model: "qwen3:8b", secretLocal: false }, ctx)) as { url: string; secretLocal: boolean; what: string };
  assert.equal(saved.url, "http://127.0.0.1:1234");
  assert.equal(saved.secretLocal, false);
  await assert.rejects(Promise.resolve(flowAction("localai.save")!.run({ url: "ftp://x" }, ctx)));
  const probe = (await flowAction("localai.probe")!.run({ url: "http://127.0.0.1:9" }, ctx)) as { ok: boolean; error: string; choices: unknown[] };
  assert.equal(probe.ok, false);
  assert.match(probe.error, /Nothing answers/);
  const { AUTO_ACTIONS, USER_ACTIONS } = await import("@/plugins/workspace/flows/user-actions");
  assert.ok(AUTO_ACTIONS.has("localai.probe") && !AUTO_ACTIONS.has("localai.save") && USER_ACTIONS.has("localai.save"), "saving takes a click");
});

test("the port's package makes the page with its block; the built-in is there through the port", { skip: !have && "zeff-plugins isn't beside Zeff" }, async () => {
  const state = await import("@/plugins/state");
  const { getDb, schema } = await import("@/db");
  state.setInstalled("local-ai", false);
  getDb().insert(schema.plugins).values({ id: "x:local-ai-ext", installed: true, changedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed: true } }).run();
  state.setInstalled("todos", true);
  assert.equal(state.isInstalled("local-ai"), true);
  assert.equal(state.onlyThroughPort("local-ai"), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(DIR, "local-ai.package.json"), "utf8"));
  const life = await import("@/plugins/workspace/package-life");
  const r = await life.installTracked(pkg, null);
  const { getBlock } = await import("@/plugins/workspace/block-store");
  assert.ok(getBlock("local-ai.settings")?.template.includes('do="localai.save"'));
  const { localAiPortPage } = await import("@/plugins/local-ai/to-plugin");
  assert.equal(await localAiPortPage(), r.rootId);
});
