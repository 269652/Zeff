import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { templateWords } from "@/plugins/workspace/view-template";

/**
 * Every text passed to t("…") in the code (server t, or a useT() t in a client component): the
 * keys of the language bundles — with where each is used. Node only (scripts, tests).
 */
const ROOT = process.cwd();

export function collectKeys(dirs = ["src", "integrations"]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name.startsWith(".") || e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  for (const file of dirs.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)))) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\bt\(/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t" && n.arguments.length) {
        const a = n.arguments[0];
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          const at = `${path.relative(ROOT, file).replace(/\\/g, "/")}:${sf.getLineAndCharacterOfPosition(a.getStart()).line + 1}`;
          keys.set(a.text, [...(keys.get(a.text) ?? []), at]);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // The view templates the plugins bring in their packages (src/plugins/*/bundled/*.package.json): their sentences, as drawn.
  for (const file of dirs.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walkPackages(path.join(ROOT, d)))) {
    const at = path.relative(ROOT, file).split(path.sep).join("/");
    for (const src of packageTemplates(JSON.parse(fs.readFileSync(file, "utf8")))) for (const key of templateWords(src)) keys.set(key, [...(keys.get(key) ?? []), at]);
  }
  return keys;
}

/** The packages bundled with plugins (a bundled/ folder's *.package.json). */
function walkPackages(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name.startsWith(".") || e.name === "node_modules" ? [] : walkPackages(path.join(d, e.name))) : e.name.endsWith(".package.json") && path.basename(d) === "bundled" ? [path.join(d, e.name)] : [],
  );
}

/** A package's view templates (its databases' views) — and its pages' titles (named in the user's language when it is installed) as a template of words. */
function packageTemplates(pkg: { items?: { title?: string; schema?: { views?: { template?: string }[] } }[] }): string[] {
  return (pkg.items ?? []).flatMap((i) => [...(i.schema?.views ?? []).map((v) => v.template ?? ""), i.title ?? ""]).filter(Boolean);
}
