import fs from "node:fs";
import path from "node:path";
import { parseManifest, type Manifest } from "./manifest";

/**
 * A plugin folder checked as a whole — what `npm run plugin:check` prints: the manifest is valid,
 * the folder is named like the id, and every file the manifest names is there (rules, panel pages,
 * scripts of hooks and MCP servers started with "./"). Node only.
 */
export type CheckResult = { ok: boolean; manifest?: Manifest; errors: string[]; warnings: string[] };

export function checkPluginFolder(dir: string): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = path.resolve(dir);
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "zeff-plugin.json"), "utf8");
  } catch {
    return { ok: false, errors: [`${root}: no zeff-plugin.json`], warnings };
  }
  const r = parseManifest(text);
  if (!r.ok) return { ok: false, errors: [r.error], warnings };
  const m = r.manifest;
  if (path.basename(root) !== m.id) errors.push(`the folder must be named "${m.id}" (it is "${path.basename(root)}")`);

  const need = (rel: string, what: string, base = root) => {
    if (!fs.existsSync(path.join(base, rel))) errors.push(`${what}: ${path.relative(root, path.join(base, rel)).replace(/\\/g, "/")} doesn't exist`);
  };
  for (const f of m.contributes.workerRules) need(f, "workerRules");
  for (const p of m.contributes.workPanels) need(p.entry, `panel "${p.id}"`, path.join(root, "ui"));
  const script = (argv: string[], what: string) => {
    for (const a of argv) if (/^\.[\\/]/.test(a)) need(a.slice(2), what);
  };
  for (const [event, h] of Object.entries(m.contributes.hooks)) if (h) script(h.command, `hook ${event}`);
  for (const [name, s] of Object.entries(m.contributes.workerMcpServers)) if ("command" in s) script([s.command, ...s.args], `MCP server "${name}"`);

  if (m.permissions.includes("exec") && !Object.keys(m.contributes.hooks).length && !Object.values(m.contributes.workerMcpServers).some((s) => "command" in s)) warnings.push('permission "exec" is asked for but nothing uses it');
  if (m.permissions.includes("prompt") && !m.contributes.workerRules.length) warnings.push('permission "prompt" is asked for but there are no workerRules');
  if (m.permissions.includes("network") && !m.contributes.workPanels.length && !Object.values(m.contributes.workerMcpServers).some((s) => "url" in s)) warnings.push('permission "network" is asked for but nothing uses it');
  if (m.contributes.apps.length && !m.contributes.workPanels.length) warnings.push("apps open panels, but there are no workPanels");
  if (!m.description) warnings.push("no description");
  return { ok: errors.length === 0, manifest: m, errors, warnings };
}
