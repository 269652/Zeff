import "@/plugins/contributions";
import { t as inLanguage } from "@/lib/i18n/server";
import { sanitizeDoc, type DocNode } from "./doc";
import { normalizeForm, type FormDef } from "./form-spec";
import { pageKind, type DbSchema, type PageKind } from "./model";
import { workspacePackages } from "./packages-point";
import { createRoutine, getRoutine, type RoutineConfig, type Step, type Trigger } from "./routines";
import { addRow, createPage, getPage, rawRows, setCell, setPageProps, tree, updatePage, updateSchema } from "./store";
import { pageState, setPageState } from "./widget-bridge";
import { adoptFlow, createFlow, flowByName, getFlow, listFlows } from "./flows/store";
import { blockFlowName, type BlockDef } from "./blocks";
import { blocksFolder, getBlock, saveBlock } from "./block-store";

/**
 * Packages: a whole app — pages, databases with fields and views, the blocks of the pages, the routines — as one JSON thing. It is made
 * from a page tree (exportPackage) and made again anywhere (installPackage): new pages with new ids, every reference put right (a
 * relation, a linked database, a form, a routine's step); what points outside the package is left out. Routines come in switched off.
 * Server only.
 */

export type PackageItem = {
  /** Its number inside the package (never a real id). */
  id: string;
  parent?: string;
  kind: PageKind;
  title: string;
  icon?: string;
  content?: DocNode;
  schema?: DbSchema;
  /** A form: what it asks (form-spec.ts) — its database by local number. */
  form?: FormDef;
  /**
   * Its rows (exported with rows): `id` their number inside the package, a relation's cell the numbers of the rows it links (the
   * ones in the package), `content` the row's own page.
   */
  rows?: PackageRow[];
  routine?: Pick<RoutineConfig, "kind" | "triggers" | "permissions" | "steps"> & { provider?: RoutineConfig["provider"] };
  /** What the widgets on this page share (zeff.page), as it was. */
  widgetState?: Record<string, unknown>;
  /** A flow's page: its definition (permissions left out — granted again by whoever installs it). */
  flow?: Record<string, unknown>;
};
export type PackageRow = { id?: string; title: string; icon?: string; cells: Record<string, unknown>; content?: DocNode };
/** A block of your own the package's views use (blocks.ts), with its flows (permissions left out — granted again by whoever installs it). */
export type PackageBlock = { def: BlockDef; flows?: Record<string, unknown>[] };
/** A step that changes the data or structure of an installed package when it moves to a newer version (db = the item's number in the package). */
export type MigrationStep =
  | { op: "rename_property"; db: string; from: string; to: string }
  | { op: "remove_property"; db: string; property: string }
  | { op: "fill"; db: string; property: string; value: unknown; onlyEmpty?: boolean }
  | { op: "copy"; db: string; from: string; to: string }
  | { op: "map"; db: string; property: string; values: Record<string, string> };
export type PackageMigration = { from: string; to: string; steps: MigrationStep[] };
/** A check that ships with the package and is run after it is installed or updated. */
export type PackageTest = { name: string } & (
  | { check: "page"; item: string }
  | { check: "property"; db: string; property: string; type?: string }
  | { check: "rows"; db: string; min?: number; max?: number }
  | { check: "view"; db: string; view?: string }
  | { check: "flow"; flow: string; input?: Record<string, unknown> }
);
export type WorkspacePackage = {
  format: 1;
  name: string;
  description?: string;
  icon?: string;
  items: PackageItem[];
  blocks?: PackageBlock[];
  /** Its identity and version: with both, an install is remembered and a newer version updates the pages in place (package-life.ts). */
  id?: string;
  version?: string;
  /** Other packages (id + range: "^1.0.0") and plugins it needs. */
  requires?: { package: string; version?: string }[];
  /** The kernel contract version it was written for (docs/kernel-contract.md; the extension API version): a newer one than this Zeff's is refused. None: 1. */
  kernel?: number;
  plugins?: string[];
  migrations?: PackageMigration[];
  tests?: PackageTest[];
  /**
   * Made in the user's language: its databases' field names, options and views, and its titles, as the language bundles (Zeff's, its
   * plugin's) have them — and its views' templates and flows calling those fields by their new names (localizePackage).
   */
  localize?: boolean;
};
export type PackageMeta = { id: string; name: string; icon: string; description: string };

/** A page of a package in the user's language: its name as the language bundles have it (a name they don't know stays as it is). */
export const pageTitleOf = (item: { title?: unknown }): string => inLanguage(String(item.title ?? ""));

const MAX_ITEMS = 200;
type Ref = number | string | undefined;
/** Where a reference goes: the new id, or undefined when it points outside. */
type Mapper = (id: unknown) => Ref;

/** Without the rollups that went through a dropped property, and the views forget it. */
function withoutProperty(schema: DbSchema, id: string): DbSchema {
  return {
    ...schema,
    properties: schema.properties.filter((x) => x.id !== id && !(x.type === "rollup" && x.rollup?.relation === id)),
    views: schema.views.map((v) => ({ ...v, hidden: v.hidden.filter((h) => h !== id), order: v.order?.filter((x) => x !== id), groupBy: v.groupBy === id ? undefined : v.groupBy, dateProp: v.dateProp === id ? undefined : v.dateProp, sorts: v.sorts.filter((s) => s.prop !== id) })),
  };
}

export function mapSchema(schema: DbSchema, f: Mapper): DbSchema {
  let next: DbSchema = JSON.parse(JSON.stringify(schema));
  for (const p of schema.properties) if (p.type === "relation" && p.relationDb !== undefined && f(p.relationDb) === undefined) next = withoutProperty(next, p.id);
  for (const p of next.properties) if (p.type === "relation" && p.relationDb !== undefined) (p as { relationDb: Ref }).relationDb = f(p.relationDb);
  if (next.pipeline) {
    next.pipeline.steps = next.pipeline.steps.flatMap((s) => {
      const o = { ...s } as Record<string, unknown>;
      for (const k of ["dbId", "to"]) {
        if (o[k] === undefined) continue;
        const m = f(o[k]);
        if (m === undefined) return [];
        o[k] = m;
      }
      return [o as unknown as typeof s];
    });
  }
  return next;
}

/** A document with the databases and pages its blocks name put right; a block that names something outside is dropped. */
/**
 * A widget's references to databases moved with the package: in its code (`db: 12`, `zeff.db.rows(12` …) a database of the package
 * becomes a placeholder (__zeffdb_i3__) on export and the new id on install; `writes` the same (one outside the package is left
 * out); its versions' id (wid) is new — a copy has a history of its own.
 */
const DB_IN_CODE = /(\bdb\s*:\s*|zeff\.db\.(?:rows|schema|add|update)\(\s*)(\d+)\b/g;
const DB_TOKEN = /__zeffdb_([a-z0-9]+)__/g;
function mapWidget(attrs: Record<string, unknown>, f: Mapper): Record<string, unknown> {
  const token = (r: Ref) => (typeof r === "string" ? `__zeffdb_${r}__` : String(r));
  const html = String(attrs.html ?? "")
    .replace(DB_TOKEN, (m, local: string) => {
      const r = f(local);
      return r === undefined ? m : token(r);
    })
    .replace(DB_IN_CODE, (m, pre: string, id: string) => {
      const r = f(Number(id));
      return r === undefined ? m : pre + token(r);
    });
  const writes = String(attrs.writes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((x) => {
      const r = f(/^\d+$/.test(x) ? Number(x) : x);
      return r === undefined ? [] : [String(r)];
    })
    .join(",");
  return { ...attrs, html, writes, wid: "" };
}

/** For package-life.ts: a document / a schema with the package's numbers put right. */

export function mapDoc(doc: DocNode, f: Mapper): DocNode | null {
  if (doc.type === "zeffApp" && doc.attrs) return { ...doc, attrs: mapWidget(doc.attrs as Record<string, unknown>, f) };
  const attrs = doc.attrs ? { ...doc.attrs } : undefined;
  if (attrs) {
    for (const k of ["dbId", "pageId", "formId"]) {
      if (attrs[k] === undefined || attrs[k] === null || attrs[k] === "") continue;
      const m = f(attrs[k]);
      if (m === undefined) return null;
      attrs[k] = m;
    }
  }
  const content = doc.content?.flatMap((c) => {
    const m = mapDoc(c, f);
    return m ? [m] : [];
  });
  return { ...doc, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
}

function mapSteps(steps: Step[], f: Mapper): Step[] {
  return steps.flatMap((s) => {
    const o = { ...s } as Record<string, unknown>;
    for (const k of ["db", "page"]) {
      if (o[k] === undefined) continue;
      const m = f(o[k]);
      if (m === undefined) return [];
      o[k] = m;
    }
    for (const k of ["then", "else", "steps"]) if (Array.isArray(o[k])) o[k] = mapSteps(o[k] as Step[], f);
    return [o as unknown as Step];
  });
}

function mapTriggers(triggers: Trigger[], f: Mapper): Trigger[] {
  return triggers.flatMap((t) => {
    if (t.kind !== "event" || t.db === undefined) return [t];
    const m = f(t.db);
    return m === undefined ? [] : [{ ...t, db: m as number }];
  });
}

const USED_BLOCK = /<use\b[^>]*?\bblock\s*=\s*["']([^"'{}]+)["']/g;
const usedBlocks = (src: string): string[] => [...src.matchAll(USED_BLOCK)].map((m) => m[1].trim().toLowerCase());

/** The blocks placed right in a page (zeffBlock nodes), anywhere in its content. */
const pageBlocks = (doc: DocNode | undefined): string[] => (!doc ? [] : [...(doc.type === "zeffBlock" && doc.attrs?.block ? [String(doc.attrs.block).toLowerCase()] : []), ...(doc.content ?? []).flatMap(pageBlocks)]);

/** The blocks of your own the exported views and pages use — and the blocks those use — with their flows. */
function blocksOf(items: PackageItem[]): PackageBlock[] {
  const queue = items.flatMap((i) => [...(i.schema?.views ?? []).flatMap((v) => (v.template ? usedBlocks(v.template) : [])), ...pageBlocks(i.content as DocNode | undefined)]);
  const seen = new Set<string>();
  const out: PackageBlock[] = [];
  while (queue.length && out.length < 50) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const def = getBlock(name);
    if (!def) continue;
    queue.push(...usedBlocks(def.template));
    const { updatedAt: _u, ...clean } = def;
    void _u;
    const prefix = blockFlowName(name, "");
    const flows = listFlows()
      .filter((f) => f.name.startsWith(prefix))
      .map((f) => {
        const { pageId: _p, lastRunAt: _l, nextRunAt: _n, permissions: _perm, parentId: _pp, title: _t, ...d } = f as typeof f & Record<string, unknown>;
        for (const x of [_p, _l, _n, _perm, _pp, _t]) void x;
        return { ...d, title: f.title, requested: f.requested ?? f.permissions } as Record<string, unknown>;
      });
    out.push({ def: clean as BlockDef, ...(flows.length ? { flows } : {}) });
  }
  return out;
}

/** The pages of a tree as a package: the page and what is below it (databases with their schema, the routines), references by local number. */
export function exportPackage(rootId: number, opts: { name: string; description?: string; icon?: string; includeRows?: boolean; /** Pages that keep a number of their own (an installed package's: its item ids); the others get new ones, added to it. */ ids?: Map<number, string> }): WorkspacePackage {
  const root = getPage(rootId);
  if (!root) throw new Error("There is no such page.");
  const all = tree();
  const order: number[] = [];
  const walk = (id: number, seen: Set<number>) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const c of all.filter((x) => x.parentId === id)) walk(c.id, seen);
  };
  walk(rootId, new Set());
  const taken = new Set(opts.ids?.values() ?? []);
  let next = 0;
  const fresh = (): string => {
    while (taken.has(`i${++next}`));
    return `i${next}`;
  };
  const local = new Map(order.map((id) => [id, opts.ids?.get(id) ?? fresh()]));
  // (The numbers given to pages that had none are added to `ids`: the caller learns them.)
  if (opts.ids) for (const [id, n] of local) if (!opts.ids.has(id)) opts.ids.set(id, n);
  const f: Mapper = (id) => local.get(Number(id));
  // (With rows: each row a number of its own, so a relation between rows of the package stays — one outside it is left out.)
  const rowLocal = new Map<number, string>();
  if (opts.includeRows) for (const id of order) if (getPage(id)?.kind === "database") for (const r of rawRows(id)) rowLocal.set(r.id, `r${rowLocal.size + 1}`);
  const items: PackageItem[] = order.map((id) => {
    const p = getPage(id)!;
    const item: PackageItem = { id: local.get(id)!, ...(id !== rootId && p.parentId ? { parent: local.get(p.parentId) } : {}), kind: p.kind, title: p.title, ...(p.icon ? { icon: p.icon } : {}) };
    if (p.kind === "database" && p.schema) {
      item.schema = mapSchema(p.schema, f);
      if (opts.includeRows) {
        const inside = new Set(p.schema.properties.filter((x) => x.type === "relation" && x.relationDb !== undefined && local.has(Number(x.relationDb))).map((x) => x.id));
        const skip = new Set(p.schema.properties.filter((x) => ["relation", "person", "todo", "ticket"].includes(x.type) && !inside.has(x.id)).map((x) => x.id));
        const linked = (v: unknown) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]).flatMap((x) => rowLocal.get(Number(x)) ?? []);
        item.rows = rawRows(id).map((r) => {
          const content = getPage(r.id)?.content as DocNode | undefined;
          const cells = Object.fromEntries(
            Object.entries(r.cells)
              .filter(([k]) => !skip.has(k))
              .map(([k, v]) => [k, inside.has(k) ? linked(v) : v]),
          );
          return { id: rowLocal.get(r.id)!, title: r.title, ...(r.icon ? { icon: r.icon } : {}), cells, ...(content?.content?.length ? { content: mapDoc(content, f) ?? undefined } : {}) };
        });
      }
    } else if (p.kind === "form") {
      const def = normalizeForm(p.props.form);
      item.form = { ...def, dbId: (f(def.dbId) ?? null) as number | null };
    } else if (p.content) {
      item.content = mapDoc(p.content as DocNode, f) ?? undefined;
    }
    const shared = pageState(id) as Record<string, unknown>;
    if (shared && Object.keys(shared).length) item.widgetState = shared;
    const fl = getFlow(id);
    if (fl) {
      const { pageId: _p, lastRunAt: _l, nextRunAt: _n, permissions: _perm, ...def } = fl;
      void _p, _l, _n, _perm;
      item.flow = { ...def, requested: fl.requested ?? fl.permissions };
    }
    const rt = getRoutine(id);
    if (rt) item.routine = { kind: rt.kind, triggers: mapTriggers(rt.triggers, f), permissions: rt.permissions, steps: mapSteps(rt.steps, f), ...(rt.provider ? { provider: rt.provider } : {}) };
    return item;
  });
  const icon = opts.icon ?? root.icon;
  const blocks = blocksOf(items);
  return { format: 1, name: opts.name, ...(opts.description ? { description: opts.description } : {}), ...(icon ? { icon } : {}), items, ...(blocks.length ? { blocks } : {}) };
}

/** A package made: new pages under `parentId`, every reference to the new ids, routines off. The id of its first page. */
/**
 * A package made in the user's language (`localize: true`): every field name, option name, title column and view name its databases
 * have — translated by the language bundles, a name they don't know staying as it is — and every place its templates, flows and
 * blocks call one of those names ('Date', "Date", [Date]) following it. A package without `localize` comes back as it is. Pure but for
 * the user's language.
 */
export function localizePackage(pkg: WorkspacePackage): WorkspacePackage {
  if (!pkg.localize) return pkg;
  const names = new Map<string, string>();
  const tr = (s: string) => {
    const out = inLanguage(s);
    if (out !== s) names.set(s, out);
    return out;
  };
  const items = pkg.items.map((i) => {
    if (i.kind !== "database" || !i.schema) return i;
    const s = i.schema;
    return {
      ...i,
      schema: {
        ...s,
        titleName: tr(s.titleName || "Name"),
        properties: s.properties.map((p) => ({ ...p, name: tr(p.name), ...(p.options ? { options: p.options.map((o) => ({ ...o, name: tr(o.name) })) } : {}) })),
        views: s.views.map((v) => ({ ...v, name: tr(v.name) })),
      },
    };
  });
  if (!names.size) return { ...pkg, items };
  // What calls a field by its name: the views' templates, the flows (their nodes and inputs), the blocks — as a quoted or bracketed name.
  const swap = (text: string) => {
    let out = text;
    for (const [from, to] of names) {
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // ('Date', "Date" or [Date] — a quote closed by the same quote, a bracket by a bracket)
      out = out.replace(new RegExp(`(['"\\[])${esc}(['"\\]])`, "g"), (m, a: string, b: string) => ((a === "[" ? b === "]" : b === a) ? `${a}${to}${b}` : m));
    }
    return out;
  };
  const deep = <T,>(v: T): T => JSON.parse(swap(JSON.stringify(v))) as T;
  return {
    ...pkg,
    items: items.map((i) => ({
      ...i,
      ...(i.kind === "database" && i.schema ? { schema: { ...i.schema, views: i.schema.views.map((v) => (v.template ? { ...v, template: swap(v.template) } : v)) } } : {}),
      ...(i.flow ? { flow: deep(i.flow) } : {}),
    })),
    ...(pkg.blocks ? { blocks: deep(pkg.blocks) } : {}),
  };
}

export function installPackage(rawPkg: WorkspacePackage, parentId: number | null): { rootId: number; ids: number[]; map: Record<string, number> } {
  const pkg = localizePackage(rawPkg);
  if (!pkg || pkg.format !== 1 || !Array.isArray(pkg.items)) throw new Error("This is not a package of pages.");
  if (!pkg.items.length) throw new Error("The package holds nothing.");
  if (pkg.items.length > MAX_ITEMS) throw new Error("The package is too large (too many pages).");
  const byId = new Map(pkg.items.map((i) => [String(i.id), i]));
  for (const i of pkg.items) if (i.parent !== undefined && !byId.has(String(i.parent))) throw new Error(`The package names a parent that is not in it (“${String(i.title)}”).`);
  if (parentId !== null && !getPage(parentId)) throw new Error("There is no such page.");
  // Parents before children; a parent that is its own ancestor is refused.
  const depth = (i: PackageItem): number => {
    let d = 0;
    for (let at: PackageItem | undefined = i; at?.parent !== undefined; at = byId.get(String(at.parent))) if (++d > MAX_ITEMS) throw new Error("The package has a parent that is its own child.");
    return d;
  };
  const sorted = [...pkg.items].sort((a, b) => depth(a) - depth(b));
  const made = new Map<string, number>();
  const f: Mapper = (id) => made.get(String(id));
  for (const i of sorted) {
    made.set(String(i.id), createPage({ parentId: i.parent === undefined ? parentId : made.get(String(i.parent)), title: pageTitleOf(i), icon: i.icon, kind: pageKind(i.kind) }));
  }
  // The blocks its views use: made when there is none of that name (yours stays as it is), with their flows (permissions asked again).
  for (const b of Array.isArray(pkg.blocks) ? pkg.blocks.slice(0, 50) : []) {
    try {
      const name = String(b?.def?.name ?? "").toLowerCase();
      if (!name || getBlock(name)) continue;
      saveBlock(b.def, { source: "package", note: pkg.name });
      for (const raw of (Array.isArray(b.flows) ? b.flows : []).slice(0, 20)) {
        try {
          if (typeof raw.name === "string" && !flowByName(raw.name)) createFlow({ ...raw, permissions: {} }, blocksFolder());
        } catch {
          /* (a flow of that name is there already, or it is not one) */
        }
      }
    } catch {
      /* (a block that does not hold: left out — the view says it is missing) */
    }
  }
  // The databases' fields first without the back sides of their relations: a back side (Projects › Notes) needs the other database's
  // relation to be there already — one made after it otherwise has none yet. The whole schema follows below.
  for (const i of pkg.items) {
    if (i.kind !== "database" || !i.schema) continue;
    const s = mapSchema(i.schema, f);
    updateSchema(made.get(String(i.id))!, { ...s, properties: s.properties.filter((p) => !p.backOf) });
  }
  // Rows: made first without their links, then the links (a row may link one made after it).
  const rowMade = new Map<string, number>();
  const links: { row: number; prop: string; to: unknown[] }[] = [];
  for (const i of pkg.items) {
    const id = made.get(String(i.id))!;
    if (i.kind === "database" && i.schema) {
      const schema = updateSchema(id, mapSchema(i.schema, f));
      const rel = new Set(schema.properties.filter((x) => x.type === "relation").map((x) => x.id));
      for (const r of i.rows ?? []) {
        const cells = Object.fromEntries(Object.entries(r.cells ?? {}).filter(([k]) => !rel.has(k)));
        const rowId = addRow(id, { title: String(r.title ?? ""), cells });
        if (r.id !== undefined) rowMade.set(String(r.id), rowId);
        for (const [k, v] of Object.entries(r.cells ?? {})) if (rel.has(k) && Array.isArray(v) && v.length) links.push({ row: rowId, prop: k, to: v });
        if (r.content) {
          const c = mapDoc(r.content, f);
          if (c) updatePage(rowId, { content: sanitizeDoc(c) });
        }
      }
    } else if (i.kind === "form" && i.form) {
      // (Its database by the new id — one outside the package: none, chosen again in the designer.)
      setPageProps(id, { form: normalizeForm({ ...i.form, dbId: f(i.form.dbId) ?? null }) });
    } else if (i.content) {
      const c = mapDoc(i.content, f);
      if (c) updatePage(id, { content: sanitizeDoc(c) });
    }
    if (i.widgetState && typeof i.widgetState === "object") for (const [k, v] of Object.entries(i.widgetState).slice(0, 100)) {
      try {
        setPageState(id, k, v);
      } catch {
        /* (too big, too many: left out) */
      }
    }
    // A flow keeps its name when it is free (the widgets call it by it); taken: the package's page stays a plain page — the flow there is used.
    if (i.flow && typeof i.flow === "object") {
      try {
        adoptFlow(id, { ...i.flow, permissions: {} });
      } catch {
        /* (a flow of that name is there already) */
      }
    }
    if (i.routine) createRoutine(id, i.routine.kind, { enabled: false, triggers: mapTriggers(i.routine.triggers ?? [], f), permissions: i.routine.permissions, steps: mapSteps(i.routine.steps ?? [], f), provider: i.routine.provider });
  }
  for (const l of links) {
    const to = l.to.flatMap((x) => rowMade.get(String(x)) ?? []);
    if (to.length) setCell(l.row, l.prop, to, { quiet: true });
  }
  const first = sorted.find((i) => i.parent === undefined) ?? sorted[0];
  return { rootId: made.get(String(first.id))!, ids: [...made.values()], map: Object.fromEntries(made) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The packages plugins bring (Zeff's own ready-made things are the templates). */
export function listPackages(): (PackageMeta & { pkg: WorkspacePackage })[] {
  return workspacePackages.list().flatMap((c) => (typeof c.impl === "function" ? c.impl() : c.impl).map((p) => ({ id: p.id ? p.id : `${c.plugin}.${slug(p.name)}`, name: p.name, icon: p.icon ?? "📦", description: p.description ?? "", pkg: p })));
}
