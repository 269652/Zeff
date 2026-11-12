import { createHash } from "node:crypto";
import { getPref, setPref } from "@/lib/prefs";
import type { WorkspacePackage } from "./packages";
import { PACKAGES_PREF } from "./package-refs";
import { getFlow } from "./flows/store";
import { getPage } from "./store";
import { compareVersions } from "./semver";

/**
 * What is remembered of the installed packages: which page is which item, what each page was as the package left it (a change since is
 * yours), the history, and the snapshots of the versions kept for a roll-back. Server only.
 */

export type HistoryEntry = { at: string; action: "install" | "update" | "rollback"; from: string | null; to: string; changes: string[]; tests?: TestResult[] };
export type InstalledPackage = {
  id: string;
  name: string;
  version: string;
  rootId: number;
  /** The package's item numbers → the pages made for them. */
  map: Record<string, number>;
  /** What each page was as the package left it: a change since then is yours. */
  hashes: Record<string, string>;
  installedAt: string;
  updatedAt: string;
  history: HistoryEntry[];
};
export type TestResult = { name: string; ok: boolean; detail: string };

const SNAP = "workspace.packages.snapshots";
const MAX_SNAPSHOT_BYTES = 1_500_000;
export const MAX_HISTORY = 50;

export const read = (): Record<string, InstalledPackage> => {
  const v = getPref<unknown>(PACKAGES_PREF, {});
  return v && typeof v === "object" ? (v as Record<string, InstalledPackage>) : {};
};
export const write = (m: Record<string, InstalledPackage>) => setPref(PACKAGES_PREF, m);
type Snapshots = Record<string, Record<string, WorkspacePackage>>;
export const readSnaps = (): Snapshots => {
  const v = getPref<unknown>(SNAP, {});
  return v && typeof v === "object" ? (v as Snapshots) : {};
};

/** A package as a snapshot: without the sample rows (the structure is what a roll-back brings back). */
function snapshotOf(pkg: WorkspacePackage): WorkspacePackage | null {
  const copy: WorkspacePackage = { ...pkg, items: pkg.items.map((i) => ({ ...i, rows: undefined })) };
  return JSON.stringify(copy).length <= MAX_SNAPSHOT_BYTES ? copy : null;
}
export function keepSnapshot(id: string, pkg: WorkspacePackage): void {
  const s = snapshotOf(pkg);
  if (!s || !pkg.version) return;
  const all = readSnaps();
  const mine = { ...(all[id] ?? {}), [pkg.version]: s };
  const versions = Object.keys(mine).sort(compareVersions);
  for (const old of versions.slice(0, Math.max(0, versions.length - 8))) delete mine[old];
  setPref(SNAP, { ...all, [id]: mine });
}

export const packageIdOf = (pkg: Pick<WorkspacePackage, "id" | "name">): string => (pkg.id?.trim() || pkg.name).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");

export const listInstalled = (): InstalledPackage[] => Object.values(read()).filter((p) => getPage(p.rootId));
export const getInstalled = (id: string): InstalledPackage | null => {
  const p = read()[id];
  return p && getPage(p.rootId) ? p : null;
};

export function hashOf(pageId: number): string {
  const p = getPage(pageId);
  if (!p) return "";
  const f = getFlow(pageId);
  const body = f ? { ...f, pageId: 0, lastRunAt: null, nextRunAt: null, permissions: null } : p.kind === "database" ? p.schema : p.kind === "form" ? p.props.form : p.content;
  return createHash("sha1").update(JSON.stringify(body ?? null)).digest("hex").slice(0, 12);
}

export const versionsKept = (id: string): string[] => Object.keys(readSnaps()[id] ?? {}).sort(compareVersions);
