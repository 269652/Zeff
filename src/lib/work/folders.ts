import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** One folder as the picker shows it: where it is, what is in it, whether it is a git repo (and on which branch). */
export type FolderListing = {
  path: string;
  /** The folder above (null: at the top - on Windows the list of drives). */
  parent: string | null;
  dirs: { name: string; path: string; repo: boolean }[];
  repo: boolean;
};

const isRepo = (dir: string) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, ".git"));

/**
 * The sub-folders of a folder (Zeff runs on your computer: this is your own file system, listed
 * for the repo picker - names only, nothing is read). No path: your home folder; on Windows
 * "" lists the drives.
 */
export function listFolder(requested: string | null | undefined): FolderListing {
  const asked = (requested ?? "").trim();
  if (process.platform === "win32" && asked === "::drives") {
    const dirs = [];
    for (let c = 65; c <= 90; c++) {
      const root = `${String.fromCharCode(c)}:/`;
      if (fs.existsSync(/*turbopackIgnore: true*/ root)) dirs.push({ name: root, path: root, repo: false });
    }
    return { path: "", parent: null, dirs, repo: false };
  }
  const dir = path.resolve(asked || os.homedir());
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} isn't a folder.`);
  const up = path.dirname(dir);
  const dirs = [];
  for (const e of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || e.name === "$RECYCLE.BIN") continue;
    const p = path.join(dir, e.name);
    dirs.push({ name: e.name, path: p, repo: isRepo(p) });
  }
  dirs.sort((a, b) => Number(b.repo) - Number(a.repo) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { path: dir, parent: up !== dir ? up : process.platform === "win32" ? "::drives" : null, dirs: dirs.slice(0, 500), repo: isRepo(dir) };
}
