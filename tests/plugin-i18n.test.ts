import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A runtime plugin brings its own texts (contributes.locales): t() finds them in the language asked — Zeff's own bundle wins where both
 * have a text —, the browser gets them as a script with a version that changes with them, and a language pack (contributes.language)
 * makes its language one Zeff can speak.
 */

const write = (dir: string, files: Record<string, string>) => {
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
};

test("a plugin's own texts: translated, the language pack's win, served to the browser, a language pack offered", async () => {
  const reg = await import("@/lib/ext/registry");
  const ps = await import("@/lib/i18n/plugin-strings");
  const { translate } = await import("@/lib/i18n/shared");
  const zeffKey = "Save";
  // A German pack (Zeff's own texts), named after the other plugin: the pack's texts still come first.
  write(path.join(reg.pluginsRoot(), "zz-german"), {
    "zeff-plugin.json": JSON.stringify({ id: "zz-german", name: "Deutsch", version: "1.0.0", apiVersion: 1, contributes: { locales: { de: "de.json" }, language: { code: "de", name: "German", native: "Deutsch", locale: "de-DE" } } }),
    "de.json": JSON.stringify({ [zeffKey]: "Speichern" }),
  });
  write(path.join(reg.pluginsRoot(), "greeter"), {
    "zeff-plugin.json": JSON.stringify({ id: "greeter", name: "Greeter", version: "1.0.0", apiVersion: 1, contributes: { locales: { de: "i18n/de.json" } } }),
    "i18n/de.json": JSON.stringify({ "Hello {name}, your plan is ready": "Hallo {name}, dein Plan steht", [zeffKey]: "the plugin's own", "<script>": "</script><b>" }),
  });
  reg.scanPlugins(true);
  ps.forgetPluginStrings();
  assert.equal(translate("de", "Hello {name}, your plan is ready", { name: "Ada" }), "Hallo Ada, dein Plan steht");
  assert.equal(translate("es", "Hello {name}, your plan is ready", { name: "Ada" }), "Hello Ada, your plan is ready", "no Spanish: English");
  assert.equal(translate("de", zeffKey), "Speichern", "the language pack's text wins");

  const v1 = ps.pluginStringsVersion("de");
  assert.match(v1, /^[0-9a-f]{12}$/);
  assert.equal(ps.pluginStringsVersion("es"), "", "no texts in Spanish: no script");
  const { GET } = await import("@/app/api/i18n/[lang]/route");
  const res = await GET(new Request(`http://zeff/api/i18n/de?v=${v1}`), { params: Promise.resolve({ lang: "de" }) });
  assert.match(res.headers.get("cache-control")!, /immutable/);
  const js = await res.text();
  assert.ok(js.startsWith("(window.__zeffStrings = window.__zeffStrings || {})[\"de\"] = "));
  assert.ok(!js.includes("</script>"), "a text can't end the script it is in");
  const g = globalThis as { window?: unknown; __zeffStrings?: unknown };
  const win: { __zeffStrings?: Record<string, Record<string, string>> } = {};
  new Function("window", js)(win);
  assert.equal(win.__zeffStrings!.de["<script>"], "</script><b>", "the browser reads them back as they were");
  void g;

  // A newer text: a new version (a new address — the old one stays cached in the browser).
  write(path.join(reg.pluginsRoot(), "greeter"), { "i18n/de.json": JSON.stringify({ "Hello {name}, your plan is ready": "Servus {name}" }) });
  ps.forgetPluginStrings();
  assert.notEqual(ps.pluginStringsVersion("de"), v1);
  assert.equal(translate("de", "Hello {name}, your plan is ready", { name: "Ada" }), "Servus Ada");

  // A language pack: its language is offered while it is installed.
  assert.deepEqual(ps.pluginLanguages().map((l) => l.code), ["de"]);
  write(path.join(reg.pluginsRoot(), "lang-es-pack"), {
    "zeff-plugin.json": JSON.stringify({ id: "lang-es-pack", name: "Español", version: "1.0.0", apiVersion: 1, contributes: { locales: { es: "es.json" }, language: { code: "es", name: "Spanish", native: "Español", locale: "es-ES" } } }),
    "es.json": JSON.stringify({ "Hello {name}, your plan is ready": "Hola {name}" }),
  });
  ps.forgetPluginStrings();
  assert.deepEqual(ps.pluginLanguages().map((l) => [l.code, l.plugin]).sort(), [["de", "zz-german"], ["es", "lang-es-pack"]]);
  ps.forgetPluginStrings();
  assert.equal(translate("es", "Hello {name}, your plan is ready", { name: "Ada" }), "Hola Ada");
});
