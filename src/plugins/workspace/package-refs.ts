/**
 * Where a package's parts are: the one place that knows how an installed package is remembered (package-life.ts keeps it in the prefs) and
 * how a part is written from outside — "@my-pkg.i3": the package's id and the item's number in it. A database made by a package has a new id
 * wherever it is installed, so a plugin's function, a flow or a view names it by its place in the package. Server only.
 */
import { getPref } from "@/lib/prefs";

export const PACKAGES_PREF = "workspace.packages.life";
const REF = /^@([a-z0-9][a-z0-9.-]*)\.(i\d+)$/;

/** Whether a text is written as a place in a package. */
export const isPackageRef = (v: unknown): v is string => typeof v === "string" && v.trim().startsWith("@");

/** The page an item of an installed package is — "@my-pkg.i3" — or null (not written so, or not installed). */
export function packagePage(ref: string): number | null {
  const m = REF.exec(ref.trim());
  if (!m) return null;
  const all = getPref<unknown>(PACKAGES_PREF, {});
  const inst = all && typeof all === "object" ? (all as Record<string, { map?: Record<string, number> }>)[m[1]] : undefined;
  const id = inst?.map?.[m[2]];
  return typeof id === "number" ? id : null;
}
