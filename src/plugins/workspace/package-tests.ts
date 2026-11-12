import type { WorkspacePackage } from "./packages";
import { getInstalled, readSnaps, type TestResult } from "./package-registry";
import { getPage, rawRows } from "./store";
import { parseView } from "./view-template";

/** The checks that ship with a package (its `tests`), run on what an install or update made. Server only. */

export async function runPackageTests(id: string, pkg?: WorkspacePackage): Promise<TestResult[]> {
  const inst = getInstalled(id);
  if (!inst) throw new Error(`The package “${id}” is not installed.`);
  const source = pkg ?? readSnaps()[id]?.[inst.version];
  const results: TestResult[] = [];
  const page = (local: string) => (inst.map[local] ? getPage(inst.map[local]) : null);
  for (const t of source?.tests ?? []) {
    let r: { ok: boolean; detail: string };
    try {
      switch (t.check) {
        case "page": {
          const p = page(t.item);
          r = p ? { ok: true, detail: `“${p.title}” is there` } : { ok: false, detail: `item ${t.item} is gone` };
          break;
        }
        case "property": {
          const p = page(t.db);
          const prop = p?.schema?.properties.find((x) => x.name.toLowerCase() === t.property.toLowerCase() || x.id === t.property);
          r = !p?.schema ? { ok: false, detail: `${t.db} is no database` } : !prop ? { ok: false, detail: `no property “${t.property}”` } : t.type && prop.type !== t.type ? { ok: false, detail: `“${t.property}” is ${prop.type}, not ${t.type}` } : { ok: true, detail: `“${t.property}” (${prop.type})` };
          break;
        }
        case "rows": {
          const n = inst.map[t.db] ? rawRows(inst.map[t.db]).length : -1;
          r = n < 0 ? { ok: false, detail: `${t.db} is no database` } : (t.min !== undefined && n < t.min) || (t.max !== undefined && n > t.max) ? { ok: false, detail: `${n} rows (wanted ${t.min ?? 0}–${t.max ?? "…"})` } : { ok: true, detail: `${n} rows` };
          break;
        }
        case "view": {
          const views = (page(t.db)?.schema?.views ?? []).filter((v) => v.template && (!t.view || v.name.toLowerCase() === t.view.toLowerCase() || v.id === t.view));
          if (!views.length) {
            r = { ok: false, detail: "no view with a template found" };
            break;
          }
          const bad = views.flatMap((v) => parseView(v.template!).errors.map((e) => `${v.name}, line ${e.line}: ${e.message}`));
          r = bad.length ? { ok: false, detail: bad.slice(0, 3).join(" | ") } : { ok: true, detail: `${views.length} view(s) hold together` };
          break;
        }
        case "flow": {
          const { runFlow } = await import("./flows/engine");
          const run = await runFlow(t.flow, t.input ?? {}, { trigger: { kind: "button" }, dry: true });
          r = run.status === "failed" ? { ok: false, detail: run.error ?? "the flow failed" } : { ok: true, detail: `dry run: ${run.status}` };
          break;
        }
        default:
          r = { ok: false, detail: "unknown check" };
      }
    } catch (e) {
      r = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    results.push({ name: t.name, ...r });
  }
  return results;
}
