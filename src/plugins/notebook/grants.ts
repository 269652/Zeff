import { getPref, setPref } from "@/lib/prefs";
import { packagePage } from "@/plugins/workspace/package-refs";

/**
 * What a notebook's code may read of Zeff. Nothing, until you allow it: the first time code asks for something it has no permission
 * for, the cell stops and asks you; an answer of yes is kept (here) and the code goes on. A permission belongs to a page ("this page
 * may read the Kennzahlen") or to every page ("*"). Resources: `tables` (the tables, calculations and results of the page, and the
 * tables shared for formulas), `metrics` (the Kennzahlen), `outputs` (the values widgets publish), `databases` (the list of databases),
 * `database:<id>` (the rows of one database). Writing has sets of its own, apart from reading: `write:outputs` (publish values for
 * widgets and the rest of Zeff — also what a named cell publishes of its result), `write:database:<id>` (add and change rows of one
 * database), `delete:database:<id>` (move its rows to the trash). Changing Zeff's own structure (the meta API) has its own sets again:
 * `meta:pages`, `meta:databases` (make new ones), `meta:schema:<id>` (fields and views of one database), `meta:blocks`, `meta:flows`,
 * `meta:plugins`. Server only.
 */

export const ALL_PAGES = "*";
const KEY = "notebook.grants";
type Map = Record<string, string[]>;

const read = (): Map => {
  const v = getPref<unknown>(KEY, {});
  const out: Map = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, list] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(list)) out[k] = list.filter((x): x is string => typeof x === "string");
  return out;
};

/**
 * A need written for a database the plugin's own package makes — `write:database:@my-pkg.i3` (the package's id and the item's number in it):
 * the database has a new id wherever the package is installed, so the manifest names it by its place in the package. This gives the real
 * key (`write:database:12`) once the package is installed, else null. Other needs are returned as they are.
 */
export function resolveNeed(need: string): string | null {
  const m = /^(write:database:|delete:database:|database:|meta:schema:)(@.+)$/.exec(need);
  if (!m) return need;
  const id = packagePage(m[2]);
  return id === null ? null : `${m[1]}${id}`;
}

/** The resources a resource name may be (the others are refused). */
export const isResource = (key: string): boolean => /^(ai|api:[a-z0-9_.-]+|tables|metrics|outputs|databases|database:\d+|write:outputs|write:database:\d+|delete:database:\d+|meta:(read|pages|databases|blocks|flows|plugins|delete)|meta:schema:\d+|call:[a-z0-9-]+\.[a-z0-9_-]+)$/.test(key);

export function isGranted(scope: number | string, key: string): boolean {
  const m = read();
  // (A page: its own and the "every page" ones. A function of a plugin, "fn:<id>": only what was granted to it.)
  return !!m[String(scope)]?.includes(key) || (!String(scope).startsWith("fn:") && !!m[ALL_PAGES]?.includes(key));
}

/** Whether every need of a plugin's functions is granted to it (a need on a package database that is not installed yet is not). */
export function needsGranted(plugin: string, needs: string[]): boolean {
  return needs.every((n) => {
    const key = resolveNeed(n);
    return key !== null && isGranted(`fn:${plugin}`, key);
  });
}

/** Grants a plugin's functions what they need ("Allow what they need"): the ones that can be named by now. */
export function grantNeeds(plugin: string, needs: string[]): void {
  for (const n of needs) {
    const key = resolveNeed(n);
    if (key && isResource(key)) addGrant(`fn:${plugin}`, key);
  }
}

export function addGrant(scope: string, key: string): void {
  if (!isResource(key) || !(scope === ALL_PAGES || /^\d+$/.test(scope) || /^fn:[a-z0-9-]+$/.test(scope))) throw new Error("No such permission.");
  const m = read();
  m[scope] = [...new Set([...(m[scope] ?? []), key])];
  setPref(KEY, m);
}

export function revokeGrant(scope: string, key: string): void {
  const m = read();
  if (!m[scope]) return;
  m[scope] = m[scope].filter((k) => k !== key);
  if (!m[scope].length) delete m[scope];
  setPref(KEY, m);
}

/** Everything allowed: by page ("*": every page), then the resources. */
export function allGrants(): { scope: string; key: string }[] {
  return Object.entries(read()).flatMap(([scope, keys]) => keys.map((key) => ({ scope, key })));
}
