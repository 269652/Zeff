/**
 * Local AI's port (zeff-plugins/plugins/local-ai-ext): its settings page, written in the view language (settings.html — the block
 * local-ai.settings), as the plugin's package: a page "Local AI" with the block on it. The page's words are Zeff's (the language packs
 * know them). Talking to the model stays the kernel's driver (src/lib/ai/local).
 *
 *   npx tsx scripts/port-local-ai.mts [<zeff-plugins folder>]     (default ../zeff-plugins)
 */
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? "../zeff-plugins");
const dir = path.join(repo, "plugins", "local-ai-ext");
const template = fs.readFileSync(path.join(dir, "settings.html"), "utf8").trim();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { version: string };
const pkg = {
  format: 1,
  id: "local-ai-ext",
  version: manifest.version,
  name: "Local AI",
  description: "The local AI's settings page: the server, the model, a test, what goes to it.",
  icon: "🖥",
  localize: true,
  items: [{ id: "i1", kind: "page", title: "Local AI", icon: "🖥", content: { type: "doc", content: [{ type: "zeffBlock", attrs: { block: "local-ai.settings", params: "{}" } }] } }],
  blocks: [{ def: { name: "local-ai.settings", title: "Local AI settings", description: "The local AI's server, model, a test and what goes to it (the Local AI plugin's page).", icon: "🖥", params: [], template } }],
};
fs.writeFileSync(path.join(dir, "local-ai.package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`${dir}: package with the block local-ai.settings (${template.length} characters)`);
