/**
 * Checks external plugin folders — the manifest and the files it names (docs/plugins/manifest.md):
 *
 *   npm run plugin:check -- path/to/plugin [more folders …]
 *   npm run plugin:check -- --all path/to/plugins-folder     every plugin inside it
 *
 * Exit code 1 when a plugin has errors (warnings are only printed).
 */
import fs from "node:fs";
import path from "node:path";
import { checkPluginFolder } from "../src/lib/ext/check";

const args = process.argv.slice(2);
const all = args.includes("--all");
let dirs = args.filter((a) => !a.startsWith("--"));
if (all) dirs = dirs.flatMap((d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name)));
if (!dirs.length) {
  console.error("Usage: npm run plugin:check -- <plugin folder> […]   |   npm run plugin:check -- --all <plugins folder>");
  process.exit(2);
}

let failed = false;
for (const dir of dirs) {
  const r = checkPluginFolder(dir);
  const c = r.manifest?.contributes;
  console.log(`${r.ok ? "✔" : "✘"} ${dir}${r.manifest ? `  (${r.manifest.id} ${r.manifest.version})` : ""}`);
  if (c) {
    const parts = [
      c.workerRules.length && `${c.workerRules.length} rule file(s)`,
      c.workCommands.length && `${c.workCommands.length} command(s)`,
      c.workPanels.length && `${c.workPanels.length} panel(s)`,
      Object.keys(c.workerMcpServers).length && `${Object.keys(c.workerMcpServers).length} MCP server(s)`,
      Object.keys(c.hooks).length && `hooks: ${Object.keys(c.hooks).join(", ")}`,
    ].filter(Boolean);
    if (parts.length) console.log(`    brings ${parts.join(", ")}`);
    if (r.manifest!.permissions.length) console.log(`    asks for ${r.manifest!.permissions.join(", ")}`);
  }
  for (const e of r.errors) console.log(`    error: ${e}`);
  for (const w of r.warnings) console.log(`    warning: ${w}`);
  if (!r.ok) failed = true;
}
process.exit(failed ? 1 : 0);
