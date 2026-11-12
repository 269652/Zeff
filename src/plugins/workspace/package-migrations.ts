import type { DbSchema, Property } from "./model";
import type { WorkspacePackage } from "./packages";
import type { InstalledPackage } from "./package-registry";
import { getPage, rawRows, setCell, updateSchema } from "./store";
import { compareVersions } from "./semver";

/** Migrations: the steps a package declares to carry an installed version to a newer one. Server only. */

const propOf = (schema: DbSchema, name: string): Property | undefined => schema.properties.find((p) => p.id === name || p.name.toLowerCase() === name.toLowerCase());

/** The declared steps from the installed version to the new one, in order: they change your data and structure before the new structure is applied. */
export function migrate(inst: InstalledPackage, pkg: WorkspacePackage, changes: string[], phase: "structure" | "data"): void {
  const steps = (pkg.migrations ?? []).filter((m) => compareVersions(m.to, inst.version) > 0 && compareVersions(m.to, pkg.version ?? inst.version) <= 0).sort((a, b) => compareVersions(a.to, b.to));
  for (const m of steps) {
    for (const s of m.steps) {
      // Renaming and removing a property come before the new structure is applied; filling, copying and re-valuing after it (the property may be new).
      if ((s.op === "rename_property" || s.op === "remove_property") !== (phase === "structure")) continue;
      const dbId = inst.map[s.db];
      const page = dbId ? getPage(dbId) : null;
      if (!page?.schema) {
        changes.push(`migration ${m.to}: ${s.db} is no database here — skipped`);
        continue;
      }
      const prop = (name: string) => propOf(page.schema!, name);
      switch (s.op) {
        case "rename_property": {
          const p = prop(s.from);
          if (!p) break;
          updateSchema(dbId, { ...page.schema, properties: page.schema.properties.map((x) => (x === p ? { ...x, name: s.to } : x)) });
          changes.push(`migration ${m.to}: “${s.from}” is now “${s.to}”`);
          break;
        }
        case "remove_property": {
          const p = prop(s.property);
          if (!p) break;
          updateSchema(dbId, { ...page.schema, properties: page.schema.properties.filter((x) => x !== p), views: page.schema.views.map((v) => ({ ...v, hidden: v.hidden.filter((h) => h !== p.id), sorts: v.sorts.filter((q) => q.prop !== p.id) })) });
          changes.push(`migration ${m.to}: “${s.property}” removed`);
          break;
        }
        case "fill": {
          const p = prop(s.property);
          if (!p) break;
          let n = 0;
          for (const r of rawRows(dbId)) {
            const cur = r.cells[p.id];
            if (s.onlyEmpty !== false && cur !== undefined && cur !== null && cur !== "" && !(Array.isArray(cur) && !cur.length)) continue;
            setCell(r.id, p.id, s.value, { quiet: true });
            n++;
          }
          changes.push(`migration ${m.to}: “${s.property}” filled in ${n} rows`);
          break;
        }
        case "copy": {
          const from = prop(s.from);
          const to = prop(s.to);
          if (!from || !to) break;
          let n = 0;
          for (const r of rawRows(dbId)) {
            const v = r.cells[from.id];
            if (v === undefined || v === null || v === "") continue;
            setCell(r.id, to.id, v, { quiet: true });
            n++;
          }
          changes.push(`migration ${m.to}: “${s.from}” copied to “${s.to}” in ${n} rows`);
          break;
        }
        case "map": {
          const p = prop(s.property);
          if (!p) break;
          const byName = (name: string) => p.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id;
          let n = 0;
          for (const r of rawRows(dbId)) {
            const cur = r.cells[p.id];
            const key = typeof cur === "string" || typeof cur === "number" ? String(cur) : "";
            const optName = p.options?.find((o) => o.id === key)?.name;
            const to = s.values[key] ?? (optName !== undefined ? s.values[optName] : undefined);
            if (to === undefined) continue;
            setCell(r.id, p.id, p.options ? (byName(to) ?? to) : to, { quiet: true });
            n++;
          }
          changes.push(`migration ${m.to}: “${s.property}” re-valued in ${n} rows`);
          break;
        }
      }
    }
  }
}
