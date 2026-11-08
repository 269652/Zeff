import fs from "node:fs";
import path from "node:path";
import { materialize } from "./run";
import type { Lambda } from "./types";

/**
 * The typings of a lambda's dependencies, for the IDE's completion: each package's own .d.ts files (or its @types package's), as
 * file:///node_modules/<package>/… — the editor's TypeScript finds an import there as it would on disk. At most 2 MB in all. Server only.
 */

const MAX = 2_000_000;

export async function typingsOf(l: Lambda): Promise<{ path: string; content: string }[]> {
  const deps = Object.keys(l.manifest.dependencies ?? {});
  if (!deps.length) return [];
  const { dir, install } = await materialize(l);
  if (!install.ok) return [];
  const out: { path: string; content: string }[] = [];
  let size = 0;
  const walk = (root: string, rel: string, depth: number) => {
    if (depth > 4 || size > MAX) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (size > MAX) return;
      const r = path.join(rel, e.name);
      if (e.isDirectory() && e.name !== "node_modules") walk(root, r, depth + 1);
      else if (/\.d\.(ts|mts|cts)$/.test(e.name) || e.name === "package.json") {
        const content = fs.readFileSync(path.join(root, r), "utf8");
        size += content.length;
        out.push({ path: `file:///node_modules/${path.basename(root) === "" ? "" : path.relative(path.join(dir, "node_modules"), root).split(path.sep).join("/")}/${r.split(path.sep).join("/")}`, content });
      }
    }
  };
  for (const name of deps) {
    for (const pkg of [name, `@types/${name.replace(/^@/, "").replace("/", "__")}`]) {
      const root = path.join(dir, "node_modules", ...pkg.split("/"));
      if (fs.existsSync(path.join(root, "package.json"))) walk(root, "", 0);
    }
  }
  return out;
}
