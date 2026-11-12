import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n/server";
import { checkPluginFolder } from "@/lib/ext/check";
import { pluginsRoot, scanPlugins } from "@/lib/ext/registry";
import { checkBlock } from "./block-check";
import { deleteBlock, listBlocks, saveBlock } from "./block-store";
import { markdownToDoc } from "./doc";
import { createFlow, deleteFlow, getFlow, listFlows, saveFlow } from "./flows/store";
import type { DbSchema } from "./model";
import { applyOps, type DbOp, type PropIn, type ViewIn } from "./schema-ops";
import * as store from "./store";

/**
 * The meta API: what code may do to Zeff's own structure — make and change pages, databases (their fields and views), blocks and
 * flows — the way the assistant and MCP do, through the same functions. For code that runs somewhere Zeff cannot see into (a
 * Notebook cell, a widget, a flow): each operation names the permission it needs (`metaAccess`), and the caller's permission layer
 * asks the user for it before `metaRun` does anything. What code makes with it is inert: a flow it saves comes without permissions
 * (it may reach nothing until you grant it in the Studio), a block is checked like any. Server only.
 */

export type MetaAccess = { key: string; label: string; description: string };

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const related = (key: number | string): DbSchema | null => (typeof key === "number" ? (store.getDatabase(key)?.schema ?? null) : null);

/** A page by its id, or by its title (the first with that title). */
function pageId(ref: unknown, what = "page"): number {
  const n = typeof ref === "number" ? ref : /^\d+$/.test(str(ref)) ? Number(str(ref)) : 0;
  if (n > 0) {
    if (!store.getPage(n)) throw new Error(`There is no ${what} ${n}.`);
    return n;
  }
  const want = str(ref).toLowerCase();
  const hit = want ? store.tree().find((x) => (x.title || "").trim().toLowerCase() === want) : null;
  if (!hit) throw new Error(`There is no ${what} “${str(ref, 60)}”.`);
  return hit.id;
}

function databaseOf(ref: unknown): { id: number; title: string } {
  const id = pageId(ref, "database");
  const d = store.getDatabase(id);
  if (!d) throw new Error(`“${str(ref, 60)}” is no database.`);
  return { id, title: d.page.title || `#${id}` };
}

export const META_OPS = ["tree", "schema", "blocks.list", "flows.list", "plugins.list", "page.create", "page.update", "page.archive", "page.delete", "database.create", "database.alter", "block.save", "block.delete", "flow.save", "flow.delete", "plugin.save", "plugin.delete"] as const;

/** The permission an operation needs; what is wrong with the request said in words (it throws). */
export function metaAccess(op: string, args: Record<string, unknown>): MetaAccess {
  switch (op) {
    case "page.create":
    case "page.update":
    case "page.archive":
      return { key: "meta:pages", label: t("make and change pages (their title and text) and move them to the trash"), description: t("Pages are made, their text and title changed, or moved to the trash (they can be brought back).") };
    case "database.create":
      return { key: "meta:databases", label: t("make new databases"), description: t("New databases with fields and views — nothing that exists is changed.") };
    case "database.alter": {
      const d = databaseOf(args.database);
      return { key: `meta:schema:${d.id}`, label: t("change the fields and views of the database “{title}”", { title: d.title }), description: t("Fields and views are added, changed or removed; removing a field removes its values.") };
    }
    case "block.save":
      return { key: "meta:blocks", label: t("make and change blocks"), description: t("Blocks for views: their template, parameters and flows. They are checked like any block.") };
    case "flow.save":
      return { key: "meta:flows", label: t("make and change flows"), description: t("A flow's steps. A flow made by code gets no permissions: it reaches nothing until you grant it in the Studio.") };
    case "tree":
    case "schema":
    case "blocks.list":
    case "flows.list":
    case "plugins.list":
      return { key: "meta:read", label: t("read how Zeff is built (pages, fields, views, blocks, flows, plugins — not the rows)"), description: t("Names, kinds and settings: the page tree, a database's fields and views, the blocks, flows and plugins there are.") };
    case "page.delete":
    case "block.delete":
    case "flow.delete":
    case "plugin.delete":
      return { key: "meta:delete", label: t("delete pages, blocks, flows and plugins for good"), description: t("Not the trash: they are gone (pages with everything below them). Moving a page to the trash is a permission of its own.") };
    case "plugin.save":
      return { key: "meta:plugins", label: t("write plugins (folders in the plugins folder)"), description: t("A plugin is written to the plugins folder, checked, and left switched off: it does nothing until you turn it on under Menu → Plugins, where you see what it asks for.") };
    default:
      throw new Error(`Zeff knows no meta operation “${str(op, 30)}” (there are: ${META_OPS.join(", ")}).`);
  }
}

/** The operation, done (only after the permission is there). Gives JSON. */
export function metaRun(op: string, a: Record<string, unknown>): unknown {
  switch (op) {
    case "page.create": {
      const title = str(a.title);
      if (!title) throw new Error("A page needs a title.");
      const md = typeof a.markdown === "string" ? a.markdown.slice(0, 200_000) : "";
      const id = store.createPage({ title, ...(str(a.icon, 16) ? { icon: str(a.icon, 16) } : {}), parentId: a.parent !== undefined && a.parent !== null ? pageId(a.parent) : null, ...(md ? { content: markdownToDoc(md) } : {}) });
      return { id };
    }
    case "page.update": {
      const id = pageId(a.id);
      const patch: Record<string, unknown> = {};
      if (typeof a.title === "string") patch.title = a.title.trim().slice(0, 300);
      if (typeof a.icon === "string") patch.icon = a.icon.slice(0, 16);
      if (typeof a.markdown === "string") patch.content = markdownToDoc(a.markdown.slice(0, 200_000));
      if (!Object.keys(patch).length) throw new Error("Nothing to change: give a title, an icon or markdown.");
      store.updatePage(id, patch);
      return { id };
    }
    case "page.archive": {
      const id = pageId(a.id);
      store.archivePage(id);
      return { id };
    }
    case "database.create": {
      const title = str(a.title);
      if (!title) throw new Error("A database needs a title.");
      const id = store.createPage({ title, ...(str(a.icon, 16) ? { icon: str(a.icon, 16) } : {}), kind: "database", parentId: a.parent !== undefined && a.parent !== null ? pageId(a.parent) : null });
      try {
        const base = store.getDatabase(id)!.schema;
        let ops: DbOp[] = [];
        if (typeof a.titleName === "string" && a.titleName.trim()) ops.push({ op: "rename_title", name: a.titleName.trim() });
        const props = Array.isArray(a.properties) ? (a.properties.slice(0, 80) as PropIn[]) : null;
        // (Given properties replace the defaults, Status and Date.)
        if (props) ops = [...base.properties.map((p): DbOp => ({ op: "remove_property", property: p.id })), ...ops, ...props.map((p): DbOp => ({ op: "add_property", ...p, name: p.name ?? "Property" }))];
        const views = Array.isArray(a.views) ? (a.views.slice(0, 20) as ({ name: string } & ViewIn)[]) : [];
        for (const v of views) ops.push({ op: "add_view", ...v });
        if (views.length) ops.push({ op: "remove_view", view: base.views[0].id });
        const { schema, notes } = applyOps(base, ops, { related });
        store.saveSchema(id, schema);
        return { id, notes };
      } catch (e) {
        // (A database that could not be shaped is not left behind half made.)
        store.deletePage(id);
        throw e;
      }
    }
    case "database.alter": {
      const d = databaseOf(a.database);
      const ops = Array.isArray(a.ops) ? (a.ops.slice(0, 100) as DbOp[]) : [];
      if (!ops.length) throw new Error("No operations: give a list like [{op: 'add_property', name: 'Betrag', type: 'number'}].");
      const { schema, notes } = applyOps(store.getDatabase(d.id)!.schema, ops, { related });
      store.updateSchema(d.id, schema);
      return { id: d.id, notes };
    }
    case "block.save": {
      const r = checkBlock(a.block);
      if (r.errors.length) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join(" · "));
      return { name: saveBlock(r.block, { source: "edit" }).name };
    }
    case "flow.save": {
      const flow = a.flow && typeof a.flow === "object" && !Array.isArray(a.flow) ? ({ ...(a.flow as Record<string, unknown>) } as Record<string, unknown>) : null;
      if (!flow) throw new Error("Give the flow as a dict: {name, steps …}.");
      if (a.page !== undefined && a.page !== null) {
        // (Changing a flow keeps the permissions it has: code cannot grant itself more.)
        const id = pageId(a.page, "flow");
        const cur = getFlow(id);
        if (!cur) throw new Error("This page is no flow.");
        const saved = saveFlow(id, { ...flow, permissions: cur.permissions });
        return { id: saved.pageId, name: saved.name };
      }
      delete flow.permissions;
      const saved = createFlow(flow, a.parent !== undefined && a.parent !== null ? pageId(a.parent) : null);
      return { id: saved.pageId, name: saved.name };
    }
    case "tree":
      return store.tree().slice(0, 3000).map((x) => ({ id: x.id, parentId: x.parentId, kind: x.kind, title: x.title, icon: x.icon }));
    case "schema": {
      const d = databaseOf(a.database);
      const s = store.getDatabase(d.id)!.schema;
      return {
        id: d.id,
        title: d.title,
        titleName: s.titleName,
        properties: s.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, ...(Array.isArray((p as { options?: unknown[] }).options) ? { options: ((p as { options: { name: string }[] }).options).map((o) => o.name) } : {}) })),
        views: s.views.map((v) => ({ id: v.id, name: v.name, type: v.type })),
      };
    }
    case "blocks.list":
      return listBlocks().map((b) => ({ name: b.name, title: b.title ?? "", description: b.description, params: b.params.map((p) => ({ name: p.name, type: p.type })) }));
    case "flows.list":
      return listFlows().map((f) => ({ id: f.pageId, name: f.name, title: f.title, description: f.description ?? "" }));
    case "plugins.list": {
      const root = pluginsRoot();
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.endsWith(".bak"))
        .map((e) => {
          try {
            const m = JSON.parse(fs.readFileSync(path.join(root, e.name, "zeff-plugin.json"), "utf8")) as Record<string, unknown>;
            return { id: e.name, name: String(m.name ?? e.name), version: String(m.version ?? ""), description: String(m.description ?? "") };
          } catch {
            return { id: e.name, name: e.name, version: "", description: "" };
          }
        });
    }
    case "page.delete": {
      const id = pageId(a.id);
      store.deletePage(id);
      return { id };
    }
    case "block.delete":
      return deleteBlock(str(a.name, 80), { flows: a.flows === true }).then((gone) => ({ gone }));
    case "flow.delete": {
      const id = pageId(a.page, "flow");
      if (!getFlow(id)) throw new Error("This page is no flow.");
      deleteFlow(id);
      store.deletePage(id);
      return { id };
    }
    case "plugin.delete": {
      const id = str(a.id, 60).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      const dir = path.join(pluginsRoot(), id);
      if (id.length < 2 || !fs.existsSync(path.join(dir, "zeff-plugin.json"))) throw new Error(`There is no plugin “${str(a.id, 60)}” in the plugins folder.`);
      fs.rmSync(dir, { recursive: true, force: true });
      scanPlugins(true);
      return { id };
    }
    case "plugin.save":
      return savePlugin(a);
    default:
      throw new Error(`Zeff knows no meta operation “${str(op, 30)}”.`);
  }
}

/**
 * A plugin written to the plugins folder: its manifest (zeff-plugin.json) and its files. Checked as a plugin folder is; a plugin that
 * does not pass is not kept (a plugin that was there stays as it was). It comes switched off — what it may do is the user's to turn on.
 */
function savePlugin(a: Record<string, unknown>): { id: string; version: string; warnings: string[] } {
  const id = str(a.id, 60).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (id.length < 2) throw new Error("A plugin's id is letters, digits and - (at least 2).");
  const manifest = a.manifest && typeof a.manifest === "object" && !Array.isArray(a.manifest) ? (a.manifest as Record<string, unknown>) : null;
  if (!manifest) throw new Error("Give the manifest as a dict (what zeff-plugin.json holds).");
  const files = a.files && typeof a.files === "object" && !Array.isArray(a.files) ? Object.entries(a.files as Record<string, unknown>) : [];
  if (files.length > 200) throw new Error("A plugin has at most 200 files here.");
  const dir = path.join(pluginsRoot(), id);
  const bak = `${dir}.bak`;
  const had = fs.existsSync(dir);
  fs.rmSync(bak, { recursive: true, force: true });
  if (had) fs.renameSync(dir, bak);
  const restore = () => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (had) fs.renameSync(bak, dir);
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const version = typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version) ? manifest.version : "1.0.0";
    fs.writeFileSync(path.join(dir, "zeff-plugin.json"), JSON.stringify({ ...manifest, id, version }, null, 2));
    for (const [rel, content] of files) {
      const clean = rel.replace(/\\/g, "/");
      if (!/^[\w.\-]+(\/[\w.\-]+)*$/.test(clean) || clean.split("/").some((x) => x === ".." || x === ".") || clean === "zeff-plugin.json") throw new Error(`Not a path inside the plugin: “${rel.slice(0, 60)}”.`);
      if (typeof content !== "string" || content.length > 1_000_000) throw new Error(`“${clean}” is not a text, or is over 1 MB.`);
      fs.mkdirSync(path.dirname(path.join(dir, clean)), { recursive: true });
      fs.writeFileSync(path.join(dir, clean), content);
    }
    const r = checkPluginFolder(dir);
    if (!r.ok) throw new Error(`The plugin does not pass the check: ${r.errors.join("; ")}`);
    fs.rmSync(bak, { recursive: true, force: true });
    scanPlugins(true);
    return { id, version, warnings: r.warnings };
  } catch (e) {
    restore();
    throw e;
  }
}
