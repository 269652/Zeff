import fs from "node:fs";
import path from "node:path";
import { mergeText } from "./git";

/**
 * An update of a plugin put together with what was changed here, the way git merges: for every file, the version the plugin was installed
 * at (base), the one in the plugins folder (mine) and the new one (theirs). Changed only there — theirs; only here — mine; on both sides —
 * git's merge of the two; where both changed the same lines differently, a conflict, held for the person (keep mine, take theirs, the
 * AI's merge, or the text as they write it). Nothing is written until no conflict is left. Server only.
 */

export type FileOutcome =
  /** nothing to do (the same on both sides, or changed only here) */
  | "keep"
  /** the new version, unchanged here */
  | "take"
  /** both changed, merged without a conflict */
  | "merged"
  /** new in the update */
  | "add"
  /** gone in the update, unchanged here */
  | "delete"
  /** both changed the same place, or one side deleted what the other changed */
  | "conflict";

export type FilePlan = {
  rel: string;
  outcome: FileOutcome;
  /** What the file becomes (null: it goes). Unset while a conflict is unresolved. */
  result?: string | null;
  /** binary file: no text merge */
  binary?: boolean;
  /** A conflict's three sides and git's text with the markers (texts; binary: none). */
  base?: string | null;
  mine?: string | null;
  theirs?: string | null;
  markers?: string;
  /** How a conflict was settled. */
  resolved?: "mine" | "theirs" | "ai" | "edited";
};

const isBinary = (b: Buffer | null): boolean => !!b && b.subarray(0, 8000).includes(0);
// (Texts compared and merged with \n line ends: a copy on Windows (\r\n) and the repository's (\n) are the same file.)
const text = (b: Buffer | null): string | null => (b === null ? null : b.toString("utf8").replace(/\r\n/g, "\n"));
const same = (a: Buffer | null, b: Buffer | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.equals(b)) return true;
  return !isBinary(a) && !isBinary(b) && text(a) === text(b);
};

/** One file's plan from its three sides (null: the file isn't there). */
export async function planFile(rel: string, base: Buffer | null, mine: Buffer | null, theirs: Buffer | null): Promise<FilePlan> {
  if (same(mine, theirs)) return { rel, outcome: "keep" };
  if (same(mine, base)) return theirs === null ? { rel, outcome: "delete", result: null } : { rel, outcome: base === null ? "add" : "take", result: theirs.toString("base64") };
  if (same(theirs, base)) return { rel, outcome: "keep" };
  const binary = isBinary(base) || isBinary(mine) || isBinary(theirs);
  if (!binary && mine !== null && theirs !== null) {
    const m = await mergeText(text(base) ?? "", text(mine)!, text(theirs)!);
    if (m.conflicts === 0) return { rel, outcome: "merged", result: Buffer.from(m.text, "utf8").toString("base64") };
    return { rel, outcome: "conflict", base: text(base), mine: text(mine), theirs: text(theirs), markers: m.text };
  }
  return { rel, outcome: "conflict", binary, ...(binary ? {} : { base: text(base), mine: text(mine), theirs: text(theirs) }) };
}

/** A conflict settled: the file becomes `content` (null: it goes). */
export function resolve(f: FilePlan, how: NonNullable<FilePlan["resolved"]>, content?: string | null): FilePlan {
  if (f.outcome !== "conflict") throw new Error(`${f.rel} has no conflict.`);
  const pick = how === "mine" ? f.mine : how === "theirs" ? f.theirs : content;
  if (f.binary && (how === "ai" || how === "edited")) throw new Error(`${f.rel} is not text — keep yours or take theirs.`);
  if (pick === undefined) throw new Error("Nothing to put there.");
  return { ...f, resolved: how, result: pick === null ? null : Buffer.from(pick, "utf8").toString("base64") };
}

// ---------------------------------------------------------------------------
// An update waiting for the person (its conflicts) — kept beside the plugins, shared by every account
// ---------------------------------------------------------------------------

export type PendingMerge = {
  pluginId: string;
  /** Where the update comes from (what the plugin's origin becomes when it is done). */
  to: { url: string; path: string; branch: string; sha: string; version: string; files: string[]; /** The key its release was signed with (lib/kernel/release.ts). */ signed?: string };
  from: { version: string | null; sha: string | null };
  files: FilePlan[];
  at: string;
};

const mergesDir = (root: string) => path.join(root, ".merges");
const fileOf = (root: string, id: string) => path.join(mergesDir(root), `${id.replace(/[^\w.-]/g, "_")}.json`);

export function savePending(root: string, m: PendingMerge): void {
  fs.mkdirSync(mergesDir(root), { recursive: true });
  fs.writeFileSync(fileOf(root, m.pluginId), JSON.stringify(m, null, 1));
}
export function pending(root: string, id: string): PendingMerge | null {
  try {
    return JSON.parse(fs.readFileSync(fileOf(root, id), "utf8")) as PendingMerge;
  } catch {
    return null;
  }
}
export function allPending(root: string): PendingMerge[] {
  try {
    return fs
      .readdirSync(mergesDir(root))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(mergesDir(root), f), "utf8")) as PendingMerge];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
export const dropPending = (root: string, id: string): void => fs.rmSync(fileOf(root, id), { force: true });

/** The conflicts still open. */
export const openConflicts = (m: PendingMerge): FilePlan[] => m.files.filter((f) => f.outcome === "conflict" && !f.resolved);

/** The plan written into the plugin's folder (only when no conflict is open): files changed, added, gone. */
export function applyPlan(dest: string, files: FilePlan[]): { written: number; removed: number } {
  if (files.some((f) => f.outcome === "conflict" && !f.resolved)) throw new Error("There are conflicts still open.");
  let written = 0;
  let removed = 0;
  for (const f of files) {
    if (f.outcome === "keep" || f.result === undefined) continue;
    const to = path.join(dest, ...f.rel.split("/"));
    if (!path.resolve(to).startsWith(path.resolve(dest) + path.sep)) continue;
    if (f.result === null) {
      if (fs.existsSync(to)) {
        fs.rmSync(to, { force: true });
        removed++;
      }
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, Buffer.from(f.result, "base64"));
    written++;
  }
  return { written, removed };
}
