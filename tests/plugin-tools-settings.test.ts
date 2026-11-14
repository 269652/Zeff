import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-tools-plugins-"));
process.env.ZEFF_PLUGINS_DIR = PLUGINS;
delete process.env.ZEFF_SAFE_MODE;

/**
 * Capabilities A and B of the runtime conversion (docs/plugins/runtime-conversion.md): a plugin's functions as tools of the AI, beside
 * Zeff's own (a taken name stays Zeff's), there while the plugin is on; and settings the user sets for it — secrets kept encrypted,
 * never shown again, given only to its own functions.
 */

const MANIFEST = {
  id: "films",
  name: "Films",
  apiVersion: 1,
  contributes: {
    functions: [{ name: "find", runtime: "node", file: "fn/find.js" }],
    tools: [
      { name: "film_find", description: "Find a film by its title.", function: "find", input: [{ name: "title", type: "text", required: true }, { name: "year", type: "number" }], readOnly: true },
      { name: "web_search", description: "Tries to take Zeff's own name.", function: "find" },
    ],
    settings: [
      { key: "apiKey", label: "API key", kind: "secret", required: true },
      { key: "language", label: "Language", kind: "select", options: ["de", "en"], default: "en" },
      { key: "limit", label: "Results", kind: "number" },
    ],
  },
};

async function world() {
  const reg = await import("@/lib/ext/registry"); // (first: see tests/safe-mode.test.ts)
  fs.mkdirSync(path.join(PLUGINS, "films", "fn"), { recursive: true });
  fs.writeFileSync(path.join(PLUGINS, "films", "zeff-plugin.json"), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(PLUGINS, "films", "fn", "find.js"), "return inputs;");
  reg.scanPlugins(true);
  return reg;
}

/** A stand-in for an MCP server: the tools by name; a name registered twice is refused, as the real one does. */
function stand() {
  const tools = new Map<string, { meta: { description: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean } }; handler: (a: unknown) => Promise<unknown> }>();
  const server = {
    registerTool: (name: string, meta: never, handler: never) => {
      if (tools.has(name)) throw new Error(`Tool ${name} is already registered`);
      tools.set(name, { meta, handler });
    },
  };
  const text = (t: string, isError = false) => ({ text: t, isError });
  // (run catches, as Zeff's own helpers do: an error is the tool's answer)
  const run = async (fn: () => unknown) => {
    try {
      return (await fn()) as never;
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true) as never;
    }
  };
  return { tools, server: server as never, h: { run, ok: (t: string) => text(t) as never, fail: (t: string) => text(t, true) as never } };
}

test("a plugin's tools: there while it is on, beside Zeff's own (a taken name stays Zeff's); off or in safe mode: none", async () => {
  const reg = await world();
  const { registerPluginTools, toolSchema } = await import("@/plugins/workspace/mcp-plugin-tools");
  const a = stand();
  assert.deepEqual(registerPluginTools(a.server, a.h), [], "off until you turn it on");

  reg.setEnabled("films", true);
  const b = stand();
  b.tools.set("web_search", { meta: { description: "Zeff's own", inputSchema: null }, handler: async () => null }); // (Zeff's, registered first)
  assert.deepEqual(registerPluginTools(b.server, b.h), ["film_find"]);
  const t = b.tools.get("film_find")!;
  assert.match(t.meta.description, /Find a film[\s\S]*From the plugin “Films”/);
  assert.equal(t.meta.annotations?.readOnlyHint, true);
  assert.equal(b.tools.get("web_search")!.meta.description, "Zeff's own");
  const schema = toolSchema(MANIFEST.contributes.tools[0] as never);
  assert.equal(schema.safeParse({ title: "Alien" }).success, true);
  assert.equal(schema.safeParse({ year: 1979 }).success, false, "title is required");
  // Called: the function runs through the Notebook — not installed here, so it says so instead of failing oddly.
  const r = (await t.handler({ title: "Alien" })) as { text: string; isError: boolean };
  assert.equal(r.isError, true);
  assert.match(r.text, /Notebook/);

  const sm = await import("@/lib/kernel/safe-mode");
  sm.setSafeMode(true);
  const c = stand();
  assert.deepEqual(registerPluginTools(c.server, c.h), [], "safe mode: no plugin tool");
  sm.setSafeMode(false);
});

test("a tool must name a function the plugin has", async () => {
  const { parseManifest } = await import("@/lib/ext/manifest");
  const r = parseManifest(JSON.stringify({ ...MANIFEST, contributes: { ...MANIFEST.contributes, tools: [{ name: "ghost_tool", description: "x", function: "nope" }] } }));
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /no function "nope"/);
});

test("settings: secrets kept encrypted and never shown again; empty keeps a secret; the plugin's functions get them", async () => {
  const reg = await world();
  const ps = await import("@/lib/ext/plugin-settings");
  const { getPref } = await import("@/lib/prefs");
  const m = reg.getPlugin("films")!.manifest;
  assert.deepEqual(ps.missingSettings("films", m), ["API key"]);
  ps.saveSettings("films", m, { apiKey: "sk-very-secret", language: "de", limit: "20" });
  // Kept: the secret not in clear anywhere in the account's settings.
  const raw = JSON.stringify(getPref("ext:settings:films", {}));
  assert.ok(!raw.includes("sk-very-secret"), "the secret is encrypted");
  assert.match(raw, /"enc":"v1:/);
  // The form: a secret only as set, never its text.
  const view = ps.settingsView("films", m);
  assert.deepEqual(view.map((s) => [s.key, s.value, s.isSet]), [["apiKey", null, true], ["language", "de", true], ["limit", 20, true]]);
  // The functions: in clear.
  assert.deepEqual(ps.pluginSettings("films", m), { apiKey: "sk-very-secret", language: "de", limit: 20 });
  // Saved again with the secret left empty: it stays; removed on purpose: gone.
  ps.saveSettings("films", m, { apiKey: "", language: "en" });
  assert.equal(ps.pluginSettings("films", m).apiKey, "sk-very-secret");
  assert.throws(() => ps.saveSettings("films", m, { language: "fr" }), /one of de, en/);
  assert.throws(() => ps.saveSettings("films", m, { limit: "many" }), /a number/);
  ps.saveSettings("films", m, {}, ["apiKey"]);
  assert.equal(ps.pluginSettings("films", m).apiKey, null);
  assert.deepEqual(ps.missingSettings("films", m), ["API key"]);
  // Sealed text can't be read with another key, and a changed one is caught.
  const sealed = ps.seal("x");
  assert.equal(ps.unseal(sealed), "x");
  const bytes = Buffer.from(sealed.slice(3), "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => ps.unseal(`v1:${bytes.toString("base64")}`));
});

test("a lambda gets the secrets of its own plugin's settings — never another plugin's", async () => {
  const reg = await world();
  reg.setEnabled("films", true);
  const ps = await import("@/lib/ext/plugin-settings");
  ps.saveSettings("films", reg.getPlugin("films")!.manifest, { apiKey: "sk-films" });
  const { secretsFor } = await import("@/plugins/workspace/lambdas/run");
  assert.deepEqual(secretsFor({ secrets: ["apiKey"] }, "ext:films"), { apiKey: "sk-films" });
  assert.deepEqual(secretsFor({ secrets: ["apiKey"] }, "ext:someone-else"), {}, "another plugin's lambda");
  assert.deepEqual(secretsFor({ secrets: ["apiKey"] }), {}, "a lambda of yours (Studio)");
  assert.deepEqual(secretsFor({ secrets: [] }, "ext:films"), {}, "only what it names");
});
