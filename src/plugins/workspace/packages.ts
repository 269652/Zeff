import "@/plugins/contributions";
import { sanitizeDoc, type DocNode } from "./doc";
import { normalizeForm, type FormDef } from "./form-spec";
import { pageKind, type DbSchema, type PageKind } from "./model";
import { workspacePackages } from "./packages-point";
import { createRoutine, getRoutine, type RoutineConfig, type Step, type Trigger } from "./routines";
import { addRow, createPage, getPage, rawRows, setCell, setPageProps, tree, updatePage, updateSchema } from "./store";

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
};
export type PackageRow = { id?: string; title: string; icon?: string; cells: Record<string, unknown>; content?: DocNode };
export type WorkspacePackage = { format: 1; name: string; description?: string; icon?: string; items: PackageItem[] };
export type PackageMeta = { id: string; name: string; icon: string; description: string };

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

function mapSchema(schema: DbSchema, f: Mapper): DbSchema {
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
function mapDoc(doc: DocNode, f: Mapper): DocNode | null {
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

/** The pages of a tree as a package: the page and what is below it (databases with their schema, the routines), references by local number. */
export function exportPackage(rootId: number, opts: { name: string; description?: string; icon?: string; includeRows?: boolean }): WorkspacePackage {
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
  const local = new Map(order.map((id, i) => [id, `i${i + 1}`]));
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
    const rt = getRoutine(id);
    if (rt) item.routine = { kind: rt.kind, triggers: mapTriggers(rt.triggers, f), permissions: rt.permissions, steps: mapSteps(rt.steps, f), ...(rt.provider ? { provider: rt.provider } : {}) };
    return item;
  });
  const icon = opts.icon ?? root.icon;
  return { format: 1, name: opts.name, ...(opts.description ? { description: opts.description } : {}), ...(icon ? { icon } : {}), items };
}

/** A package made: new pages under `parentId`, every reference to the new ids, routines off. The id of its first page. */
export function installPackage(pkg: WorkspacePackage, parentId: number | null): { rootId: number; ids: number[] } {
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
    made.set(String(i.id), createPage({ parentId: i.parent === undefined ? parentId : made.get(String(i.parent)), title: String(i.title ?? ""), icon: i.icon, kind: pageKind(i.kind) }));
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
    if (i.routine) createRoutine(id, i.routine.kind, { enabled: false, triggers: mapTriggers(i.routine.triggers ?? [], f), permissions: i.routine.permissions, steps: mapSteps(i.routine.steps ?? [], f), provider: i.routine.provider });
  }
  for (const l of links) {
    const to = l.to.flatMap((x) => rowMade.get(String(x)) ?? []);
    if (to.length) setCell(l.row, l.prop, to, { quiet: true });
  }
  const first = sorted.find((i) => i.parent === undefined) ?? sorted[0];
  return { rootId: made.get(String(first.id))!, ids: [...made.values()] };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The packages plugins bring (Zeff's own ready-made things are the templates). */
export function listPackages(): (PackageMeta & { pkg: WorkspacePackage })[] {
  return workspacePackages.list().flatMap((c) => c.impl.map((p) => ({ id: `${c.plugin}.${slug(p.name)}`, name: p.name, icon: p.icon ?? "📦", description: p.description ?? "", pkg: p })));
}
