/**
 * A plugin's texts moved out of Zeff's language bundles into the plugin's own locale files (zeff-plugin.json → contributes.locales):
 * the texts its packages draw (views, blocks, page titles) are written to <plugin>/i18n/<lang>.json with their translations; the ones
 * Zeff itself no longer uses anywhere else are taken out of the language packs (the plugin's repository: plugins/lang-<lang>/bundle.json).
 *
 *   npx tsx scripts/i18n-extract-plugin.mts <plugin folder> [--keep]     (--keep: Zeff's bundles stay as they are)
 *
 * Example: npx tsx scripts/i18n-extract-plugin.mts ../zeff-plugins/plugins/learn
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "");
const keep = process.argv.includes("--keep");
const manifestFile = path.join(dir, "zeff-plugin.json");
if (!fs.existsSync(manifestFile)) throw new Error(`No zeff-plugin.json in ${dir}.`);

// (Zeff's own texts: those stay in Zeff's bundles)
const { collectKeys } = await import("../src/lib/i18n/collect");
const { templateWords } = await import("../src/plugins/workspace/view-template");

type Pkg = { items?: { title?: string; schema?: { views?: { template?: string }[] }; content?: unknown }[]; blocks?: { def?: { template?: string; title?: string; description?: string } }[] };
const templates = (pkg: Pkg): string[] => [...(pkg.items ?? []).flatMap((i) => [...(i.schema?.views ?? []).map((v) => v.template ?? ""), i.title ?? ""]), ...(pkg.blocks ?? []).map((b) => b.def?.template ?? "")].filter(Boolean);

const packages = fs.readdirSync(dir).filter((f) => f.endsWith(".package.json"));
const words = new Set<string>();
for (const f of packages) for (const src of templates(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Pkg)) for (const k of templateWords(src)) words.add(k);

const zeff = collectKeys();
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { contributes?: { locales?: Record<string, string> } };
manifest.contributes ??= {};
manifest.contributes.locales ??= {};
for (const lang of ["de", "es"]) {
  // (the language pack beside the plugin in its repository: <repo>/plugins/lang-<lang>)
  const bundleFile = path.resolve(dir, "..", `lang-${lang}`, "bundle.json");
  const raw = fs.readFileSync(bundleFile, "utf8");
  const bundle = JSON.parse(raw) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const k of [...words].sort()) if (bundle[k]) out[k] = bundle[k];
  const rel = `i18n/${lang}.json`;
  fs.mkdirSync(path.join(dir, "i18n"), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(out, null, 2)}\n`);
  manifest.contributes.locales[lang] = rel;
  const gone = Object.keys(out).filter((k) => !zeff.has(k));
  if (!keep) {
    for (const k of gone) delete bundle[k];
    const nl = raw.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(bundleFile, JSON.stringify(bundle, null, 2).replace(/\n/g, nl) + (raw.endsWith(nl) ? nl : ""));
  }
  console.log(`${lang}: ${Object.keys(out).length} texts into ${rel}; ${keep ? "kept" : "taken out of"} Zeff's bundle: ${gone.length} (the rest Zeff uses itself)`);
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
