import { isInstalled } from "@/plugins/state";
import { sanitizeDoc, type DocNode } from "./doc";
import { normalizeForm } from "./form-spec";
import { pageKind, type DbSchema } from "./model";
import { exportPackage, installPackage, localizePackage, mapDoc, mapSchema, pageTitleOf, type PackageItem, type WorkspacePackage } from "./packages";
import { addSavePoint, savePoint, savePoints, type SavePoint } from "./app-savepoints";
import { blocksFolder, getBlock, saveBlock } from "./block-store";
import { addRow, createPage, getPage, setPageProps, updatePage, updateSchema } from "./store";
import { setPageState } from "./widget-bridge";
import { adoptFlow, createFlow, flowByName, getFlow, saveFlow } from "./flows/store";
import { createRoutine } from "./routines";
import { compareVersions, satisfies } from "./semver";
import { getInstalled, hashOf, keepSnapshot, listInstalled, MAX_HISTORY, packageIdOf, read, readSnaps, versionsKept, write, type HistoryEntry, type TestResult } from "./package-registry";
import { migrate } from "./package-migrations";
import { mergeDoc, mergeRecord, type Merged } from "./merge-parts";
import { CONTRACT_VERSION, OLDEST_CONTRACT } from "@/lib/kernel/contract";
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
  const k = kernelProblem(pkg, CONTRACT_VERSION);
  if (k) problems.push(k);
  for (const p of pkg.plugins ?? []) if (!isInstalled(p as never)) problems.push(`The plugin “${p}” is needed (Menu → Plugins).`);
  const have = read();
  for (const r of pkg.requires ?? []) {
    const d = have[r.package];
    if (!d || !getPage(d.rootId)) problems.push(`The package “${r.package}”${r.version ? ` (${r.version})` : ""} is needed first.`);
    else if (!satisfies(d.version, r.version)) problems.push(`The package “${r.package}” is installed in version ${d.version}, but ${r.version} is needed.`);
  }
  return problems;
}

/** Why a package can't run on a kernel of this contract version (null: it can). Today a contract version only grows; one below the
 * oldest a kernel still speaks would be refused too, once there is one (OLDEST_CONTRACT). */
export function kernelProblem(pkg: Pick<WorkspacePackage, "kernel" | "name">, version: number): string | null {
  const wants = Number.isInteger(pkg.kernel) && pkg.kernel! > 0 ? pkg.kernel! : 1;
  if (wants > version) return `“${pkg.name}” is made for a newer Zeff (kernel contract ${wants}; this one speaks ${version}) — update Zeff first.`;
  if (wants < OLDEST_CONTRACT) return `“${pkg.name}” is made for kernel contract ${wants}, which this Zeff no longer speaks (${OLDEST_CONTRACT}–${version}).`;
  return null;
}

/**
 * Before a kernel update: the installed apps that a kernel of `version` couldn't run, with why — shown before Zeff is updated, so
 * nothing stops working unannounced (docs/zeff-kernel.md, "How an update arrives").
 */
export function appsBlockingKernel(version: number): { id: string; name: string; problem: string }[] {
  const snaps = readSnaps();
  return listInstalled().flatMap((i) => {
    const pkg = snaps[i.id]?.[i.version];
    const problem = pkg ? kernelProblem(pkg, version) : null;
    return problem ? [{ id: i.id, name: i.name, problem }] : [];
  });
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
export function installRemember(rawPkg: WorkspacePackage, parentId: number | null): { rootId: number; id: string; remembered: boolean } {
  // (in the user's language — the snapshot too, so the next update merges like with like)
  const pkg = localizePackage(rawPkg);
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

export type UpdateReport = { id: string; from: string; to: string; changes: string[]; kept: string[]; /** Spots both you and the update changed: yours kept (also in `kept`). */ conflicts?: string[]; tests: TestResult[]; /** The flows given what they ask for (allow). */ allowed?: string[] };

/**
 * Properties and views the package adds to a database you changed; yours stay as they are. A view of the package's own takes what the new
 * version changed in it where you left it as one of the versions before had it (its template, its sorts …, each on its own) — a column
 * width of yours doesn't keep a new screen of the app away. Without the versions before (no snapshots) the views stay as they are.
 */
function mergeSchema(current: DbSchema, next: DbSchema, before: DbSchema[] = []): { schema: DbSchema; added: string[] } {
  const added: string[] = [];
  const props = [...current.properties];
  for (const p of next.properties) {
    if (props.some((x) => x.id === p.id)) continue;
    props.push(p);
    added.push(`added property “${p.name}”`);
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const views = [...current.views];
  for (const v of next.views) {
    const at = views.findIndex((x) => x.id === v.id);
    if (at < 0) {
      views.push(v);
      added.push(`added view “${v.name}”`);
      continue;
    }
    const olds = before.flatMap((b) => b.views.filter((x) => x.id === v.id)) as unknown as Record<string, unknown>[];
    if (!olds.length) continue;
    const mine = views[at] as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...mine };
    let took = false;
    for (const [k, nv] of Object.entries(v as unknown as Record<string, unknown>)) {
      if (same(mine[k], nv) || !olds.some((was) => same(mine[k], was[k]))) continue;
      merged[k] = nv;
      took = true;
    }
    if (took) {
      views[at] = merged as unknown as (typeof views)[number];
      added.push(`view “${v.name}” updated`);
    }
  }
  return { schema: { ...current, properties: props, views }, added };
}

/** What an item is updated with: whether it is new, whether it is as the package left it (else it is yours), the package's numbers → pages. */
type ItemEnv = {
  isNew: boolean;
  untouched: boolean;
  f: (local: unknown) => number | undefined;
  changes: string[];
  kept: string[];
  /** The item as the versions before had it (their snapshots, those kept). */
  before: PackageItem[];
  /** The item as the version installed until now had it: the base of the three-way merge (merge-parts.ts) — none: kept the old way. */
  base?: PackageItem;
  /** Spots both you and the new version changed: yours kept, named here. */
  conflicts: string[];
};
type PageOf = NonNullable<ReturnType<typeof getPage>>;
/** One kind of item brought to the new version; true: it was one of this kind. Add a kind of item = add one function here. */
type Applier = (i: PackageItem, page: PageOf, env: ItemEnv) => boolean | Promise<boolean>;

/** A merge's outcome said in the report: what came from the update, where both changed (yours kept). */
function report(page: PageOf, r: Merged<unknown>, env: ItemEnv): void {
  if (r.took.length) env.changes.push(`“${page.title}”: ${r.took.length} change${r.took.length === 1 ? "" : "s"} of the update merged with yours`);
  for (const c of r.conflicts) env.conflicts.push(`“${page.title}” ${c.where}: changed by you and by the update — yours stays`);
}

const applyDatabase: Applier = (i, page, env) => {
  const { isNew, untouched, f, changes, kept, before, base } = env;
  if (i.kind !== "database" || !i.schema) return false;
  const mapped = mapSchema(i.schema, f);
  if (untouched) {
    if (JSON.stringify(page.schema) !== JSON.stringify(mapped)) {
      updateSchema(page.id, mapped);
      if (!isNew) changes.push(`“${page.title}”: structure updated`);
    }
  } else if (base?.kind === "database" && base.schema && page.schema) {
    // Field by field, view by view, by their ids.
    const older = before.flatMap((b) => (b.kind === "database" && b.schema ? [mapSchema(b.schema, f) as never] : []));
    const r = mergeRecord(mapSchema(base.schema, f) as never, page.schema as never, mapped as never, "", older);
    if (JSON.stringify(r.value) !== JSON.stringify(page.schema)) updateSchema(page.id, r.value as unknown as DbSchema);
    report(page, r, env);
  } else {
    const merged = mergeSchema(page.schema!, mapped, before.flatMap((b) => (b.kind === "database" && b.schema ? [mapSchema(b.schema, f)] : [])));
    if (merged.added.length) {
      updateSchema(page.id, merged.schema);
      changes.push(`“${page.title}”: ${merged.added.join(", ")}`);
    }
    kept.push(`“${page.title}”: your changes to its structure stay`);
  }
  if (isNew) {
    const rel = new Set((getPage(page.id)?.schema?.properties ?? []).filter((x) => x.type === "relation").map((x) => x.id));
    for (const r of i.rows ?? []) addRow(page.id, { title: String(r.title ?? ""), cells: Object.fromEntries(Object.entries(r.cells ?? {}).filter(([k]) => !rel.has(k))) });
  }
  return true;
};

const applyForm: Applier = (i, page, env) => {
  const { untouched, f, kept, base } = env;
  if (i.kind !== "form" || !i.form) return false;
  const theirs = normalizeForm({ ...i.form, dbId: f(i.form.dbId) ?? null });
  const mine = (page.props as { form?: unknown } | undefined)?.form;
  if (untouched) setPageProps(page.id, { form: theirs });
  else if (base?.kind === "form" && base.form && mine && typeof mine === "object") {
    const r = mergeRecord(normalizeForm({ ...base.form, dbId: f(base.form.dbId) ?? null }) as never, mine as never, theirs as never, "");
    setPageProps(page.id, { form: normalizeForm(r.value as never) });
    report(page, r, env);
  } else kept.push(`“${page.title}” (form): your version stays`);
  return true;
};

const applyFlow: Applier = (i, page, env) => {
  const { isNew, untouched, changes, kept, base } = env;
  if (!i.flow || typeof i.flow !== "object") return false;
  const cur = getFlow(page.id);
  if (cur && untouched) {
    saveFlow(page.id, { ...i.flow, permissions: cur.permissions });
    if (!isNew) changes.push(`flow “${page.title}” updated (its permissions stay as you gave them)`);
  } else if (cur && base?.flow && typeof base.flow === "object") {
    // Step by step (by their ids), its settings key by key; its permissions stay as you gave them.
    const strip = (x: object) => {
      const { permissions: _p, requested: _r, pageId: _i, ...rest } = x as Record<string, unknown>;
      void _p, void _r, void _i;
      return rest;
    };
    const r = mergeRecord(strip(base.flow), strip(cur), strip(i.flow), "");
    if (r.took.length) saveFlow(page.id, { ...(r.value as typeof cur), permissions: cur.permissions });
    report(page, r, env);
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

const applyContent: Applier = async (i, page, env) => {
  const { isNew, untouched, f, changes, kept, base } = env;
  if (!i.content) return false;
  if (!untouched && base?.content && page.content) {
    // Block by block (a paragraph, a heading, a widget), the way git merges lines.
    const theirs = mapDoc(i.content, f);
    const was = mapDoc(base.content, f);
    if (theirs && was) {
      const r = await mergeDoc(sanitizeDoc(was) as never, page.content as never, sanitizeDoc(theirs) as never, "text");
      const doc = sanitizeDoc(r.value as never);
      if (JSON.stringify(doc) !== JSON.stringify(page.content)) updatePage(page.id, { content: doc });
      report(page, r, env);
    } else kept.push(`“${page.title}”: your version stays`);
  } else if (!untouched) kept.push(`“${page.title}”: your version stays`);
  else {
    const c = mapDoc(i.content, f);
    if (c && JSON.stringify(sanitizeDoc(c)) !== JSON.stringify(page.content)) {
      updatePage(page.id, { content: sanitizeDoc(c) });
      if (!isNew) changes.push(`“${page.title}” updated`);
    }
  }
  return true;
};

/**
 * The package's blocks of your own (its pages and views use them): one that is not there is made, with its flows (permissions asked for
 * again); one you left as a version before had it takes the new version; one you changed stays yours (unless `force`).
 */
function applyBlocks(id: string, pkg: WorkspacePackage, env: { force: boolean; changes: string[]; kept: string[] }): void {
  const before = Object.values(readSnaps()[id] ?? {}).flatMap((p) => p.blocks ?? []);
  const plain = (d: unknown) => {
    const { updatedAt: _u, ...rest } = (d ?? {}) as Record<string, unknown>;
    void _u;
    return JSON.stringify(rest);
  };
  for (const b of (pkg.blocks ?? []).slice(0, 50)) {
    try {
      const name = String(b?.def?.name ?? "").toLowerCase();
      if (!name) continue;
      const cur = getBlock(name);
      if (cur && plain(cur) === plain(b.def)) continue;
      const untouched = !cur || env.force || before.some((o) => String(o.def?.name).toLowerCase() === name && plain(o.def) === plain(cur));
      if (!untouched) {
        env.kept.push(`block “${name}”: your version stays`);
        continue;
      }
      saveBlock(b.def, { source: "package", note: pkg.name });
      env.changes.push(cur ? `block “${name}” updated` : `new block “${name}”`);
      for (const raw of (Array.isArray(b.flows) ? b.flows : []).slice(0, 20)) {
        try {
          if (typeof raw.name === "string" && !flowByName(raw.name)) createFlow({ ...raw, permissions: {} }, blocksFolder());
        } catch {
          /* (not a flow) */
        }
      }
    } catch {
      /* (a block that does not hold: left out — where it is used says it is missing) */
    }
  }
}

const APPLIERS: Applier[] = [applyDatabase, applyForm, applyFlow, applyContent];

export async function updateTracked(id: string, rawPkg: WorkspacePackage, opts: { force?: boolean; rollback?: boolean; /** The flows of the new version get what they ask for (as when it was installed with "allow"). */ allow?: boolean; /** (A save point brought back: no version snapshot of it, no save point before — the caller kept one.) */ fromSavePoint?: boolean } = {}): Promise<UpdateReport> {
  const inst = getInstalled(id);
  if (!inst) throw new Error(`The package “${id}” is not installed.`);
  const pkg = localizePackage(rawPkg);
  if (!pkg.version) throw new Error("This package has no version.");
  if (!opts.rollback && compareVersions(pkg.version, inst.version) <= 0) throw new Error(`Version ${pkg.version} is not newer than the installed ${inst.version}.`);
  const problems = checkRequirements(pkg);
  if (problems.length) throw new Error(problems.join(" "));
  // The whole app as it is now: a save point, so this update or roll-back can be undone.
  if (!opts.fromSavePoint) {
    try {
      keepAppState(id, opts.rollback ? `Before going back to ${pkg.version}` : `Before the update to ${pkg.version}`, true);
    } catch {
      /* (a save point that can't be made doesn't stop the update) */
    }
  }
  const changes: string[] = [];
  const kept: string[] = [];
  const oldVersion = inst.version;
  const now0 = getInstalled(id) ?? inst;
  const map = { ...now0.map };
  const hashes = { ...now0.hashes };
  const f = (local: unknown) => map[String(local)];
  // What the versions before were (their snapshots): what you left as one of them had it may take what the new version changed.
  const oldItems = new Map<string, PackageItem[]>();
  for (const snap of Object.values(readSnaps()[id] ?? {})) for (const x of snap.items ?? []) oldItems.set(String(x.id), [...(oldItems.get(String(x.id)) ?? []), x]);
  // The base of the three-way merge: each item as the version installed until now had it.
  const baseItems = new Map((readSnaps()[id]?.[inst.version]?.items ?? []).map((x) => [String(x.id), x] as const));
  const conflicts: string[] = [];

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
    const before = oldItems.get(key) ?? [];
    const base = baseItems.get(key);
    for (const apply of APPLIERS) if (await apply(i, page, { isNew, untouched, f, changes, kept, before, base, conflicts })) break;
    if (isNew && i.widgetState && typeof i.widgetState === "object") for (const [k, v] of Object.entries(i.widgetState).slice(0, 100)) {
      try {
        setPageState(pid, k, v);
      } catch {
        /* (too big: left out) */
      }
    }
    if (isNew && i.routine) createRoutine(pid, i.routine.kind, { enabled: false, triggers: i.routine.triggers ?? [], permissions: i.routine.permissions, steps: i.routine.steps ?? [], provider: i.routine.provider });
  }
  applyBlocks(id, pkg, { force: !!opts.force, changes, kept });
  if (!opts.rollback) migrate({ ...inst, map }, pkg, changes, "data");
  for (const [k, pid] of Object.entries(inst.map)) if (!byId.has(k) && getPage(pid)) kept.push(`“${getPage(pid)!.title}” is no longer in the package — it stays`);

  for (const k of Object.keys(map)) hashes[k] = hashOf(map[k]);
  const now = new Date().toISOString();
  const entry: HistoryEntry = { at: now, action: opts.rollback ? "rollback" : "update", from: oldVersion, to: pkg.version, changes: changes.length ? changes : ["nothing to change"] };
  const all = read();
  all[id] = { ...inst, name: pkg.name, version: pkg.version, map, hashes, updatedAt: now, history: [...inst.history, entry].slice(-MAX_HISTORY) };
  write(all);
  if (!opts.fromSavePoint) keepSnapshot(id, pkg);
  const allowed = opts.allow ? allowRequested(all[id].rootId, id) : [];
  const tests = await runPackageTests(id, pkg);
  if (tests.length) {
    const m = read();
    const h = m[id].history;
    h[h.length - 1].tests = tests;
    write(m);
  }
  return { id, from: oldVersion, to: pkg.version, changes: entry.changes, kept: [...kept, ...conflicts], conflicts, tests, allowed };
}

/** Back to a version kept: the structure of that version is brought back over yours (migrated data is not undone). */
export async function rollbackTracked(id: string, version: string): Promise<UpdateReport> {
  const snap = readSnaps()[id]?.[version];
  if (!snap) throw new Error(`No snapshot of version ${version} is kept (${Object.keys(readSnaps()[id] ?? {}).join(", ") || "none"}).`);
  return updateTracked(id, snap, { force: true, rollback: true });
}

/**
 * A version kept (or the one installed now) as a separate app of its own — or, `template`, as one of your templates — beside the installed
 * one, which stays as it is. Its pages, databases (empty: a version keeps the structure, not your entries), views, forms and widgets are
 * its own; flows are named globally, so where the installed app has a flow of that name the copy uses that one (as any package does). Its
 * flows get no permissions and its routines are switched off, as with every install. Not remembered as an installed package.
 */
export async function snapshotAsNew(id: string, version: string, opts: { template?: boolean } = {}): Promise<{ rootId: number; title: string }> {
  const inst = getInstalled(id);
  const snap = readSnaps()[id]?.[version];
  if (!snap) throw new Error(`No snapshot of version ${version} is kept (${Object.keys(readSnaps()[id] ?? {}).join(", ") || "none"}).`);
  // (Without id and version: not remembered, not updated with the installed one.)
  const r = installPackage({ ...snap, id: undefined, version: undefined, migrations: undefined, requires: undefined }, null);
  const title = `${getPage(r.rootId)?.title || inst?.name || snap.name} (${version})`;
  updatePage(r.rootId, { title });
  if (opts.template) (await import("./templates")).setTemplate(r.rootId, true);
  return { rootId: r.rootId, title };
}

/** A version kept as a package file's content (the one installed now: its current pages, `exportPackage`). */
export function snapshotPackage(id: string, version: string): WorkspacePackage {
  const snap = readSnaps()[id]?.[version];
  if (!snap) throw new Error(`No snapshot of version ${version} is kept (${Object.keys(readSnaps()[id] ?? {}).join(", ") || "none"}).`);
  return snap;
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

// ---------------------------------------------------------------------------
// Save points of the whole app (app-savepoints.ts): its top page and everything below it at one moment
// ---------------------------------------------------------------------------

/** The installed app whose top page this is (its history is the whole app's). */
export const appOfPage = (pageId: number) => listInstalled().find((p) => p.rootId === Number(pageId)) ?? null;

/**
 * The whole app as it is now kept as a save point. A page added below it since it was installed becomes part of it here (a number of its
 * own in the app), so a save point brings it back as it was too, instead of making it again.
 */
export function keepAppState(id: string, label: string, auto = false): SavePoint | null {
  const inst = getInstalled(id);
  if (!inst) throw new Error(`The package “${id}” is not installed.`);
  const ids = new Map(Object.entries(inst.map).map(([k, v]) => [v, k] as [number, string]));
  const before = ids.size;
  const pkg = exportPackage(inst.rootId, { name: inst.name, ids });
  if (ids.size > before) {
    const all = read();
    const me = all[id];
    for (const [pageId, n] of ids) {
      if (n in me.map) continue;
      me.map[n] = pageId;
      me.hashes[n] = hashOf(pageId);
    }
    write(all);
  }
  return addSavePoint(id, { ...pkg, id, version: inst.version }, { label, auto, version: inst.version });
}

/** The whole app back to a save point (what it is now kept as one first). Entries stay; pages added since stay. */
export async function restoreSavePoint(id: string, n: number): Promise<UpdateReport> {
  const inst = getInstalled(id);
  const sp = savePoint(id, Number(n));
  if (!inst || !sp) throw new Error("There is no such save point.");
  keepAppState(id, `Before going back to the save point of ${sp.at.slice(0, 16).replace("T", " ")}`, true);
  return updateTracked(id, { ...sp.pkg, id, version: inst.version }, { force: true, rollback: true, fromSavePoint: true });
}

/** A save point as a separate app beside this one, or one of your templates (as snapshotAsNew). */
export async function savePointAsNew(id: string, n: number, opts: { template?: boolean } = {}): Promise<{ rootId: number; title: string }> {
  const sp = savePoint(id, Number(n));
  if (!sp) throw new Error("There is no such save point.");
  const r = installPackage({ ...sp.pkg, id: undefined, version: undefined, migrations: undefined, requires: undefined }, null);
  const title = `${getPage(r.rootId)?.title || sp.pkg.name} (${sp.at.slice(0, 16).replace("T", " ")})`;
  updatePage(r.rootId, { title });
  if (opts.template) (await import("./templates")).setTemplate(r.rootId, true);
  return { rootId: r.rootId, title };
}

/** The whole app's history for its top page: the versions kept (install, updates) and the save points, newest first. */
export function appHistory(id: string): { id: string; name: string; version: string; versions: string[]; savePoints: SavePoint[] } {
  const inst = getInstalled(id);
  if (!inst) throw new Error(`The package “${id}” is not installed.`);
  return { id, name: inst.name, version: inst.version, versions: [...versionsKept(id)].reverse(), savePoints: savePoints(id) };
}
