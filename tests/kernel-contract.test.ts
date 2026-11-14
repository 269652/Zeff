import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CONTRACT_VERSION, extensionPointForms, KERNEL_CONTRACT, pointsWithoutStoredForm } from "@/lib/kernel/contract";
import { API_VERSION } from "@/lib/ext/manifest";

/**
 * The kernel contract (src/lib/kernel/contract.ts) is what the code offers — not more, not less. When this test fails, the code and
 * the contract went apart: add what is new to contract.ts; for what is gone, see docs/kernel-contract.md (deprecation, then a new
 * API_VERSION).
 */

const SRC = path.join(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Both ways: what the code has and the contract misses, and what the contract names and the code lost. */
function same(label: string, inCode: Iterable<string>, inContract: Iterable<string>) {
  const code = new Set(inCode);
  const contract = new Set(inContract);
  const added = [...code].filter((x) => !contract.has(x)).sort();
  const lost = [...contract].filter((x) => !code.has(x)).sort();
  assert.deepEqual(
    { added, lost },
    { added: [], lost: [] },
    `${label}: new in the code → add to src/lib/kernel/contract.ts: [${added.join(", ")}]; gone from the code (a breaking change — docs/kernel-contract.md): [${lost.join(", ")}]`,
  );
}

test("the contract's version is the extension API version", () => {
  assert.equal(CONTRACT_VERSION, API_VERSION);
});

test("extension points: every point in the code is in the contract", () => {
  const names: string[] = [];
  for (const file of walk(SRC)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /extensionPoint<.*>\(\s*"([\w.]+)"\s*\)/.exec(line);
      if (m) names.push(m[1]);
    }
  }
  same("extension points", names, Object.keys(KERNEL_CONTRACT.extensionPoints));
});

test("extension points: a stored one names a manifest key that exists; a kernel one says what plugins use instead", () => {
  const contributes: readonly string[] = KERNEL_CONTRACT.manifestContributes;
  for (const [name, p] of extensionPointForms()) {
    if (p.form === "stored") assert.ok(contributes.includes(p.manifest), `${name}: the manifest has no "${p.manifest}"`);
    if (p.form === "kernel") assert.ok(contributes.includes(p.via), `${name}: plugins reach it through "${p.via}", which the manifest lacks`);
    if (p.form === "covered") {
      const ok = p.by.startsWith("view:") ? (KERNEL_CONTRACT.viewElements as readonly string[]).includes(p.by.slice(5)) : contributes.includes(p.by);
      assert.ok(ok, `${name}: covered by "${p.by}", which the contract doesn't have`);
    }
    if (p.form === "owner") assert.ok(fs.existsSync(path.join(SRC, "plugins", p.owner)), `${name}: no built-in plugin "${p.owner}"`);
  }
  // Every point is reachable by a plugin, or said why not (kernel, owner). A new point must say which it is.
  assert.deepEqual(pointsWithoutStoredForm(), []);
});

test("manifest: what a plugin may contribute", () => {
  const src = read("lib/ext/manifest.ts");
  const block = /^const contributes = z\.object\(\{\n([\s\S]*?)\n\}\);/m.exec(src);
  assert.ok(block, "the contributes schema in lib/ext/manifest.ts");
  const keys = [...block[1].matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
  same("manifest contributes", keys, KERNEL_CONTRACT.manifestContributes);
});

test("functions and cells: the zeff.* calls", () => {
  const src = read("plugins/notebook/zeff-access.ts");
  const from = src.indexOf("export async function accessFor");
  const to = src.indexOf("export async function", from + 1);
  assert.ok(from >= 0 && to > from, "accessFor in plugins/notebook/zeff-access.ts");
  const ops = [...src.slice(from, to).matchAll(/case "([a-z_]+)"/g)].map((m) => m[1]);
  same("function calls", ops, KERNEL_CONTRACT.functionCalls);
});

test("widgets: the zeff.* calls", async () => {
  const { CALL_METHODS } = await import("@/lib/widgets/bridge");
  same("widget calls", Object.keys(CALL_METHODS), KERNEL_CONTRACT.widgetCalls);
});

test("meta: the structure operations", async () => {
  const { META_OPS } = await import("@/plugins/workspace/meta");
  same("meta ops", META_OPS, KERNEL_CONTRACT.metaOps);
});

test("flows: the step kinds", async () => {
  const { NODE_KINDS } = await import("@/plugins/workspace/flows/types");
  same("flow nodes", NODE_KINDS, KERNEL_CONTRACT.flowNodes);
});

test("views: the elements of the view language", async () => {
  const { VIEW_TAGS } = await import("@/plugins/workspace/view-template");
  same("view elements", Object.keys(VIEW_TAGS), KERNEL_CONTRACT.viewElements);
});

test("formulas: the functions", async () => {
  const { FORMULA_FUNCTIONS } = await import("@/plugins/workspace/formula");
  same("formula functions", FORMULA_FUNCTIONS, KERNEL_CONTRACT.formulaFunctions);
});
