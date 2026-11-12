import { isInstalled } from "@/plugins/state";
import { sanitizeDoc, type DocNode } from "./doc";
import { normalizeForm } from "./form-spec";
import { pageKind, type DbSchema } from "./model";
import { installPackage, mapDoc, mapSchema, pageTitleOf, type PackageItem, type WorkspacePackage } from "./packages";
import { addRow, createPage, getPage, setPageProps, updatePage, updateSchema } from "./store";
import { setPageState } from "./widget-bridge";
import { adoptFlow, getFlow, saveFlow } from "./flows/store";
import { createRoutine } from "./routines";
import { compareVersions, satisfies } from "./semver";
import { getInstalled, hashOf, keepSnapshot, listInstalled, MAX_HISTORY, packageIdOf, read, readSnaps, versionsKept, write, type HistoryEntry, type TestResult } from "./package-registry";
import { migrate } from "./package-migrations";
import { runPackageTests } from "./package-tests";

// What used to live in this file, still found here: versions, the registry, the tests that ship with a package.
export { compareVersions, satisfies } from "./semver";
export { getInstalled, listInstalled, packageIdOf, versionsKept, type HistoryEntry, type InstalledPackage, type TestResult } from "./package-registry";
export { runPackageTests } from "./package-tests";

/**
 * Packages that live: a package has an identity (id), a version, dependencies, migrations, permissions it needs and tests that ship with it.
 * Installing one is remembered (which page is which item of the package), so a newer version updates the pages in place: what you changed
 * stays, what the package adds is added, data is migrated by declared steps, every step is in a history that can be rolled back. Server only.
 */

// ---------------------------------------------------------------------------
// Requirements and permissions
// ---------------------------------------------------------------------------

/** What stands in the way of installing this package (empty: nothing). */
export function checkRequirements(pkg: WorkspacePackage): string[] {
  const problems: string[] = [];
  for (const p of pkg.plugins ?? []) if (!isInstalled(p as never)) problems.push(`The plugin “${p}” is needed (Menu → Plugins).`);
  const have = read();
  for (const r of pkg.requires ?? []) {
    const d = have[r.package];
    if (!d || !getPage(d.rootId)) problems.push(`The package “${r.package}”${r.version ? ` (${r.version})` : ""} is needed first.`);
    else if (!satisfies(d.version, r.version)) problems.push(`The package “${r.package}” is installed in version ${d.version}, but ${r.version} is needed.`);
  }
  return problems;
}

const describePerm = (o: unknown): string[] =>
  o && typeof o === "object"
    ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v === false || v === null || v === undefined || (Array.isArray(v) && !v.length) ? [] : [Array.isArray(v) ? `${k}: ${v.join(", ")}` : v === true ? k : `${k}: ${String(v)}`]))
    : [];

/** What a package asks to be allowed, before it is installed: flows, routines, widgets with code, plugins. */
export function packagePermissions(pkg: WorkspacePackage): { flows: string[]; routines: string[]; widgets: string[]; plugins: string[]; requires: string[] } {
  const flows: string[] = [];
  const widgets: string[] = [];
  const routines: string[] = [];
  const flowLine = (f: Record<string, unknown>) => {
    const wants = describePerm(f.requested ?? f.permissions);
    if (wants.length) flows.push(`${String(f.title ?? f.name)}: ${wants.join("; ")}`);
  };
  for (const i of pkg.items) {
    if (i.flow) flowLine(i.flow);
    if (i.routine) {
      const wants = describePerm(i.routine.permissions);
      if (wants.length) routines.push(`${i.title}: ${wants.join("; ")} (it comes in switched off)`);
    }
    const walk = (n: DocNode | undefined) => {
      if (!n) return;
      if (n.type === "zeffApp") {
        const a = (n.attrs ?? {}) as Record<string, unknown>;
        const writes = String(a.writes ?? "").trim();
        widgets.push(`${String(a.title || "A widget")} on “${i.title}” runs code${writes ? ` and may write to databases ${writes}` : ""} (it asks you for what it needs)`);
      }
      n.content?.forEach(walk);
    };
    walk(i.content);
  }
  for (const b of pkg.blocks ?? []) for (const f of b.flows ?? []) flowLine(f);
  return { flows, routines, widgets, plugins: pkg.plugins ?? [], requires: (pkg.requires ?? []).map((r) => `${r.package}${r.version ? ` ${r.version}` : ""}`) };
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/** Installs a package and remembers it (when it has a version): the later versions update these pages in place. */
export function installRemember(pkg: WorkspacePackage, parentId: number | null): { rootId: number; id: string; remembered: boolean } {
  const problems = checkRequirements(pkg);
  if (problems.length) throw new Error(problems.join(" "));
  const id = packageIdOf(pkg);
  if (pkg.version && getInstalled(id)) throw new Error(`“${pkg.name}” is installed already (version ${getInstalled(id)!.version}) — update it instead.`);
  const res = installPackage(pkg, parentId);
  if (!pkg.version) return { rootId: res.rootId, id, remembered: false };
  const now = new Date().toISOString();
  const hashes = Object.fromEntries(Object.entries(res.map).map(([k, pid]) => [k, hashOf(pid)]));
  write({ ...read(), [id]: { id, name: pkg.name, version: pkg.version, rootId: res.rootId, map: res.map, hashes, installedAt: now, updatedAt: now, history: [{ at: now, action: "install", from: null, to: pkg.version, changes: [`${res.ids.length} pages made`] }] } });
  keepSnapshot(id, pkg);
  return { rootId: res.rootId, id, remembered: true };
}

/** The same, and the package's own tests run on what was made. */
export async function installTracked(pkg: WorkspacePackage, parentId: number | null, opts: { allow?: boolean } = {}): Promise<{ rootId: number; tests: TestResult[]; remembered: boolean; allowed: string[] }> {
  const r = installRemember(pkg, parentId);
  const allowed = opts.allow ? allowRequested(r.rootId, r.id) : [];
  if (!r.remembered) return { rootId: r.rootId, tests: [], remembered: false, allowed };
  const tests = await runPackageTests(r.id, pkg);
  if (tests.length) {
    const m = read();
    m[r.id].history[0].tests = tests;
    write(m);
  }
  return { rootId: r.rootId, tests, remembered: true, allowed };
}

/**
 * The permissions the package's flows asked for, given — only when the person said so ("install and allow what it asks"): each flow of the
 * package gets what it requested. Returns the flows that got something. Without a version the package is not remembered: its pages are
 * found from the root.
 */
function allowRequested(rootId: number, id: string): string[] {
  const inst = getInstalled(id);
  const pages = inst ? Object.values(inst.map) : [];
  const out: string[] = [];
  for (const pid of pages.length ? pages : [rootId]) {
    const f = getFlow(pid);
    if (!f?.requested || !Object.keys(f.requested).length) continue;
    saveFlow(pid, { ...f, permissions: f.requested });
    out.push(f.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Update in place
// ---------------------------------------------------------------------------

export type UpdateReport = { id: string; from: string; to: string; changes: string[]; kept: string[]; tests: TestResult[]; /** The flows given what they ask for (allow). */ allowed?: string[] };

/** Properties and views the package adds to a database you changed; yours stay as they are. */
function mergeSchema(current: DbSchema, next: DbSchema): { schema: DbSchema; added: string[] } {
  const added: string[] = [];
  const props = [...current.properties];
  for (const p of next.properties) {
    if (props.some((x) => x.id === p.id)) continue;
    props.push(p);
    added.push(`property “${p.name}”`);
  }
  const views = [...current.views];
  for (const v of next.views) {
    if (views.some((x) => x.id === v.id)) continue;
    views.push(v);
    added.push(`view “${v.name}”`);
  }
  return { schema: { ...current, properties: props, views }, added };
}

/** What an item is updated with: whether it is new, whether it is as the package left it (else it is yours), the package's numbers → pages. */
type ItemEnv = { isNew: boolean; untouched: boolean; f: (local: unknown) => number | undefined; changes: string[]; kept: string[] };
type PageOf = NonNullable<ReturnType<typeof getPage>>;
/** One kind of item brought to the new version; true: it was one of this kind. Add a kind of item = add one function here. */
type Applier = (i: PackageItem, page: PageOf, env: ItemEnv) => boolean;

const applyDatabase: Applier = (i, page, { isNew, untouched, f, changes, kept }) => {
  if (i.kind !== "database" || !i.schema) return false;
  const mapped = mapSchema(i.schema, f);
  if (untouched) {
    if (JSON.stringify(page.schema) !== JSON.stringify(mapped)) {
      updateSchema(page.id, mapped);
      if (!isNew) changes.push(`“${page.title}”: structure updated`);
    }
  } else {
    const merged = mergeSchema(page.schema!, mapped);
    if (merged.added.length) {
      updateSchema(page.id, merged.schema);
      changes.push(`“${page.title}”: added ${merged.added.join(", ")}`);
    }
    kept.push(`“${page.title}”: your changes to its structure stay`);
  }
  if (isNew) {
    const rel = new Set((getPage(page.id)?.schema?.properties ?? []).filter((x) => x.type === "relation").map((x) => x.id));
    for (const r of i.rows ?? []) addRow(page.id, { title: String(r.title ?? ""), cells: Object.fromEntries(Object.entries(r.cells ?? {}).filter(([k]) => !rel.has(k))) });
  }
  return true;
};

const applyForm: Applier = (i, page, { untouched, f, kept }) => {
  if (i.kind !== "form" || !i.form) return false;
  if (untouched) setPageProps(page.id, { form: normalizeForm({ ...i.form, dbId: f(i.form.dbId) ?? null }) });
  else kept.push(`“${page.title}” (form): your version stays`);
  return true;
};

const applyFlow: Applier = (i, page, { isNew, untouched, changes, kept }) => {
  if (!i.flow || typeof i.flow !== "object") return false;
  const cur = getFlow(page.id);
  if (cur && untouched) {
    saveFlow(page.id, { ...i.flow, permissions: cur.permissions });
    if (!isNew) changes.push(`flow “${page.title}” updated (its permissions stay as you gave them)`);
  } else if (cur) kept.push(`flow “${page.title}”: your version stays`);
  else if (isNew) {
    try {
      adoptFlow(page.id, { ...i.flow, permissions: {} });
    } catch {
      /* (a flow of that name is there already) */
    }
  }
  return true;
};

const applyContent: Applier = (i, page, { isNew, untouched, f, changes, kept }) => {
  if (!i.content) return false;
  if (!untouched) kept.push(`“${page.title}”: your version stays`);
  else {
    const c = mapDoc(i.content, f);
    if (c && JSON.stringify(sanitizeDoc(c)) !== JSON.stringify(page.content)) {
      updatePage(page.id, { content: sanitizeDoc(c) });
      if (!isNew) changes.push(`“${page.title}” updated`);
    }
  }
  return true;
};

const APPLIERS: Applier[] = [applyDatabase, applyForm, applyFlow, applyContent];

export async function updateTracked(id: string, pkg: WorkspacePackage, opts: { force?: boolean; rollback?: boolean; /** The flows of the new version get what they ask for (as when it was installed with "allow"). */ allow?: boolean } = {}): Promise<UpdateReport> {
  const inst = getInstalled(id);
  if (!inst) throw new Error(`The package “${id}” is not installed.`);
  if (!pkg.version) throw new Error("This package has no version.");
  if (!opts.rollback && compareVersions(pkg.version, inst.version) <= 0) throw new Error(`Version ${pkg.version} is not newer than the installed ${inst.version}.`);
  const problems = checkRequirements(pkg);
  if (problems.length) throw new Error(problems.join(" "));
  const changes: string[] = [];
  const kept: string[] = [];
  const oldVersion = inst.version;
  const map = { ...inst.map };
  const hashes = { ...inst.hashes };
  const f = (local: unknown) => map[String(local)];

  if (!opts.rollback) {
    // (A page that was yours-untouched stays so after the migration changed it: the new structure still replaces it.)
    const clean = Object.keys(inst.map).filter((k) => hashOf(inst.map[k]) === inst.hashes[k]);
    migrate(inst, pkg, changes, "structure");
    for (const k of clean) hashes[k] = hashOf(inst.map[k]);
  }

  // New items first (parents before children), so references find them.
  const byId = new Map(pkg.items.map((i) => [String(i.id), i]));
  const depth = (i: PackageItem): number => {
    let d = 0;
    for (let at: PackageItem | undefined = i; at?.parent !== undefined && d < 100; at = byId.get(String(at.parent))) d++;
    return d;
  };
  const sorted = [...pkg.items].sort((a, b) => depth(a) - depth(b));
  const fresh = new Set<string>();
  for (const i of sorted) {
    if (map[String(i.id)] && getPage(map[String(i.id)])) continue;
    map[String(i.id)] = createPage({ parentId: i.parent === undefined ? inst.rootId : (map[String(i.parent)] ?? inst.rootId), title: pageTitleOf(i), icon: i.icon, kind: pageKind(i.kind) });
    fresh.add(String(i.id));
    changes.push(`new ${i.kind} “${i.title}”`);
  }

  for (const i of sorted) {
    const key = String(i.id);
    const pid = map[key];
    const page = getPage(pid);
    if (!page) continue;
    const isNew = fresh.has(key);
    const untouched = isNew || opts.force || hashOf(pid) === hashes[key];
    if (page.kind !== pageKind(i.kind)) {
      kept.push(`“${page.title}” is a ${page.kind} now, the package says ${i.kind} — left as it is`);
      continue;
    }
    for (const apply of APPLIERS) if (apply(i, page, { isNew, untouched, f, changes, kept })) break;
    if (isNew && i.widgetState && typeof i.widgetState === "object") for (const [k, v] of Object.entries(i.widgetState).slice(0, 100)) {
      try {
        setPageState(pid, k, v);
      } catch {
        /* (too big: left out) */
      }
    }
    if (isNew && i.routine) createRoutine(pid, i.routine.kind, { enabled: false, triggers: i.routine.triggers ?? [], permissions: i.routine.permissions, steps: i.routine.steps ?? [], provider: i.routine.provider });
  }
  if (!opts.rollback) migrate({ ...inst, map }, pkg, changes, "data");
  for (const [k, pid] of Object.entries(inst.map)) if (!byId.has(k) && getPage(pid)) kept.push(`“${getPage(pid)!.title}” is no longer in the package — it stays`);

  for (const k of Object.keys(map)) hashes[k] = hashOf(map[k]);
  const now = new Date().toISOString();
  const entry: HistoryEntry = { at: now, action: opts.rollback ? "rollback" : "update", from: oldVersion, to: pkg.version, changes: changes.length ? changes : ["nothing to change"] };
  const all = read();
  all[id] = { ...inst, name: pkg.name, version: pkg.version, map, hashes, updatedAt: now, history: [...inst.history, entry].slice(-MAX_HISTORY) };
  write(all);
  keepSnapshot(id, pkg);
  const allowed = opts.allow ? allowRequested(all[id].rootId, id) : [];
  const tests = await runPackageTests(id, pkg);
  if (tests.length) {
    const m = read();
    const h = m[id].history;
    h[h.length - 1].tests = tests;
    write(m);
  }
  return { id, from: oldVersion, to: pkg.version, changes: entry.changes, kept, tests, allowed };
}

/** Back to a version kept: the structure of that version is brought back over yours (migrated data is not undone). */
export async function rollbackTracked(id: string, version: string): Promise<UpdateReport> {
  const snap = readSnaps()[id]?.[version];
  if (!snap) throw new Error(`No snapshot of version ${version} is kept (${Object.keys(readSnaps()[id] ?? {}).join(", ") || "none"}).`);
  return updateTracked(id, snap, { force: true, rollback: true });
}


// ---------------------------------------------------------------------------
// What is installed, what is on offer
// ---------------------------------------------------------------------------

export type PackageStatus = { id: string; name: string; version: string; rootId: number; offered: string | null; updateAvailable: boolean; versionsKept: string[]; lastChange: string };

/** The installed packages, with the newest version on offer (from the plugins' packages) and whether it is newer. */
export async function packageStatus(): Promise<PackageStatus[]> {
  const { listPackages } = await import("./packages");
  const offers = listPackages().map((o) => o.pkg);
  return listInstalled().map((p) => {
    const best = offers.filter((o) => o.version && packageIdOf(o) === p.id).sort((a, b) => compareVersions(b.version!, a.version!))[0];
    const last = p.history[p.history.length - 1];
    return { id: p.id, name: p.name, version: p.version, rootId: p.rootId, offered: best?.version ?? null, updateAvailable: !!best?.version && compareVersions(best.version, p.version) > 0, versionsKept: versionsKept(p.id), lastChange: last ? `${last.at.slice(0, 10)}: ${last.action} ${last.to}` : "" };
  });
}

/** The newest offered package for an installed id (its source for an update). */
export async function offeredPackage(id: string): Promise<WorkspacePackage | null> {
  const { listPackages } = await import("./packages");
  return (
    listPackages()
      .map((o) => o.pkg)
      .filter((o) => o.version && packageIdOf(o) === id)
      .sort((a, b) => compareVersions(b.version!, a.version!))[0] ?? null
  );
}

/** An offered package by its listed id or name (for an install). */
export async function findOffered(key: string): Promise<WorkspacePackage | null> {
  const { listPackages } = await import("./packages");
  const k = key.trim().toLowerCase();
  return listPackages().find((o) => o.id.toLowerCase() === k || packageIdOf(o.pkg) === k || o.name.toLowerCase() === k)?.pkg ?? null;
}
