import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Every text passed to t("…") in the code (server t, or a useT() t in a client component): the
 * keys of the language bundles — with where each is used. Node only (scripts, tests).
 */
const ROOT = process.cwd();

export function collectKeys(dirs = ["src"]): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  for (const file of dirs.flatMap((d) => walk(path.join(ROOT, d)))) {
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
  return keys;
}
