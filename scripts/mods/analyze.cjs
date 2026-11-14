/* eslint-disable @typescript-eslint/no-require-imports -- a build loader (and what it uses) is CommonJS: Turbopack loads webpack loaders with require() */
/**
 * The hook points of a source file (mods, docs/mods.md): every exported function and component gets a name — its file below src/
 * without the extension, "#", its export name ("plugins/workspace/store#updateSchema") — and a hash of its code, so a mod written
 * for one version of it is held back when Zeff changes it. Used by the build loader (hook-loader.cjs: the hooks put in) and the catalog
 * (catalog.cjs: what the AI and the Mods page list). Build time only (the TypeScript parser).
 *
 * Left out, on purpose: files with "use server" / "use cache" (Next compiles their exports itself), Next's own functions
 * (generateMetadata …), declarations without a body (overloads), anything that is no function, and the mod runtime itself.
 */
const crypto = require("node:crypto");
const ts = require("typescript");

const SKIP_NAMES = new Set(["generateMetadata", "generateStaticParams", "generateViewport", "generateImageMetadata", "generateSitemaps", "register", "onRequestError", "middleware", "proxy", "config"]);
// lib/kernel/ is what stays in charge while mods run (safe mode, the start guard, the contract): no mod may replace it.
const SKIP_FILES = /(^|\/)(lib\/mods\/|lib\/kernel\/|instrumentation[^/]*\.ts$|middleware\.ts$|proxy\.ts$)|\.test\.tsx?$|\.d\.ts$/;

const hash = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);

/** The directive prologue's end ("use client" must stay first): the offset after the last directive. */
function prologueEnd(sf) {
  let end = 0;
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) end = st.end;
    else break;
  }
  return end;
}

const directives = (sf) => {
  const out = [];
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) out.push(st.expression.text);
    else break;
  }
  return out;
};

const hasMod = (node, kind) => (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === kind);

function unwrap(e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression;
  return e;
}

/**
 * @param {string} rel  the file's path below src/, "/" separated ("plugins/workspace/store.ts")
 * @param {string} code its text
 * @returns {{ skip?: string, client: boolean, points: { id: string, name: string, kind: "function"|"component", async: boolean, hash: string, line: number, params: string, isDefault: boolean, constAt?: number }[], prologueEnd: number }}
 */
function analyze(rel, code) {
  const file = rel.replace(/\\/g, "/");
  if (SKIP_FILES.test(file)) return { skip: "not hooked", client: false, points: [], prologueEnd: 0 };
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const dirs = directives(sf);
  if (dirs.includes("use server") || dirs.includes("use cache")) return { skip: dirs.join(", "), client: false, points: [], prologueEnd: 0 };
  const base = file.replace(/\.(tsx?|jsx?)$/, "");
  const points = [];
  const add = (name, fnNode, isDefault, constAt) => {
    if (!name || SKIP_NAMES.has(name)) return;
    const isAsync = hasMod(fnNode, ts.SyntaxKind.AsyncKeyword);
    const params = fnNode.parameters.map((p) => p.getText(sf)).join(", ").replace(/\s+/g, " ").slice(0, 300);
    points.push({
      id: `${base}#${name}`,
      name,
      kind: /^[A-Z]/.test(name) && file.endsWith(".tsx") ? "component" : "function",
      async: isAsync,
      hash: hash(fnNode.getText(sf)),
      line: sf.getLineAndCharacterOfPosition(fnNode.getStart(sf)).line + 1,
      params,
      isDefault,
      ...(constAt !== undefined ? { constAt } : {}),
    });
  };
  for (const st of sf.statements) {
    if (!hasMod(st, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(st)) {
      if (!st.body || !st.name) continue; // (an overload, or an anonymous default: nothing to name)
      add(st.name.text, st, hasMod(st, ts.SyntaxKind.DefaultKeyword));
    } else if (ts.isVariableStatement(st)) {
      const list = st.declarationList;
      if (!(list.flags & ts.NodeFlags.Const) || list.declarations.length !== 1) continue;
      const d = list.declarations[0];
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = unwrap(d.initializer);
      if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
      // (the offset of "const": it becomes "let", so the hooked function can take its place)
      const constAt = list.getStart(sf);
      add(d.name.text, init, false, constAt);
    }
  }
  return { client: dirs.includes("use client"), points, prologueEnd: prologueEnd(sf) };
}

/**
 * The file with its hooks: the import of the runtime (after the directives), "const" made "let" where an exported arrow function is
 * hooked, and at the end each hooked export replaced by its hook (a Proxy around it: with no mod it only calls it).
 */
function transform(rel, code) {
  const a = analyze(rel, code);
  if (!a.points.length) return code;
  let out = code;
  // From the end, so offsets stay right.
  for (const p of [...a.points].filter((x) => x.constAt !== undefined).sort((x, y) => y.constAt - x.constAt)) {
    if (out.slice(p.constAt, p.constAt + 5) !== "const") return code; // (not as expected: the file is left as it is)
    out = `${out.slice(0, p.constAt)}let  ${out.slice(p.constAt + 5)}`;
  }
  const imp = `\nimport { __zeffHook as __zeffHook__ } from "@/lib/mods/hook";\n`;
  out = `${out.slice(0, a.prologueEnd)}${a.prologueEnd ? ";" : ""}${imp}${out.slice(a.prologueEnd)}`;
  const lines = a.points.map((p) => `${p.name} = __zeffHook__(${JSON.stringify(p.id)}, ${p.name}, ${JSON.stringify(p.hash)}, ${JSON.stringify(p.kind)});`);
  return `${out}\n// (hooks for mods: lib/mods/hook.ts)\n${lines.join("\n")}\n`;
}

module.exports = { analyze, transform, SKIP_FILES };
