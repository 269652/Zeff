/**
 * What external plugins bring to the Workspace through their functions (a manifest's contributes.lookups and contributes.sources):
 * a lookup's search and details, a source's records are each read by a plugin function (Python or Node.js, run by the Notebook plugin).
 * The function only does what the user granted it (Settings → Notebook → Functions). Server only.
 */
import { getPlugin, scanPlugins } from "@/lib/ext/registry";
import { runPluginFunction } from "./plugin-fn";
import type { LookupHit, LookupSource, LookupValue } from "./lookup-point";
import type { WorkspaceSource } from "./source-point";
import type { SourceRecord } from "./pipeline";
import type { WorkspaceFieldType } from "./field-point";

const call = runPluginFunction;

const str = (v: unknown, max = 500) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").slice(0, max);
const enabled = () => scanPlugins().plugins.filter((p) => getPlugin(p.id)?.enabled);

/** Field types external plugins declare: checked by a pattern, a range or a list of choices - no code. */
export function externalFieldTypes(): WorkspaceFieldType[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.fieldTypes.map((f): WorkspaceFieldType => {
      const re = f.pattern ? new RegExp(f.pattern) : null;
      return {
        id: `${p.id}.${f.id}`,
        label: f.label,
        icon: f.icon,
        description: f.description,
        display: f.display,
        ...(f.max ? { max: f.max } : {}),
        ...(f.href ? { href: f.href } : {}),
        ...(f.kind === "choice" ? { suggestions: () => f.options } : {}),
        parse: (input) => {
          const s = input.trim();
          if (s === "") return null;
          if (f.kind === "number") {
            const n = Number(s.replace(",", "."));
            if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.maxValue !== undefined && n > f.maxValue)) throw new Error(`${f.label}: ${f.min ?? "…"}-${f.maxValue ?? "…"}`);
            return n;
          }
          if (f.kind === "choice") {
            const hit = f.options.find((o) => o.toLowerCase() === s.toLowerCase());
            if (!hit) throw new Error(`${f.label}: ${f.options.join(", ")}`);
            return hit;
          }
          if (re && !re.test(s)) throw new Error(`${f.label}: ${s} does not fit`);
          return s.slice(0, 500);
        },
      };
    }),
  );
}

export function externalLookups(): LookupSource[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.lookups.map(
      (l): LookupSource => ({
        id: `${p.id}.${l.id}`,
        label: l.label,
        what: l.what,
        fields: l.fields,
        ...(l.credit ? { credit: l.credit } : {}),
        slow: l.slow,
        search: async (query, language) => {
          const v = await call(p.id, l.search, { query, language });
          return (Array.isArray(v) ? v : []).slice(0, 20).flatMap((h): LookupHit[] => {
            const o = h && typeof h === "object" ? (h as Record<string, unknown>) : null;
            if (!o || !str(o.id) || !str(o.title)) return [];
            return [{ id: str(o.id, 200), title: str(o.title, 200), ...(str(o.subtitle) ? { subtitle: str(o.subtitle, 200) } : {}), ...(/^https?:\/\//.test(str(o.image)) ? { image: str(o.image, 500) } : {}) }];
          });
        },
        details: async (id, language) => {
          const v = await call(p.id, l.details, { id, language });
          const out: Record<string, LookupValue> = {};
          if (v && typeof v === "object" && !Array.isArray(v))
            for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
              if (x === null || typeof x === "string" || typeof x === "number") out[k] = x as LookupValue;
              else if (Array.isArray(x)) out[k] = x.map((y) => str(y, 200)).filter(Boolean);
            }
          return out;
        },
      }),
    ),
  );
}

export function externalSources(): WorkspaceSource[] {
  return enabled().flatMap((p) =>
    p.manifest.contributes.sources.map(
      (s): WorkspaceSource => ({
        id: `${p.id}.${s.id}`,
        label: s.label,
        icon: s.icon,
        hint: s.hint,
        noNewRows: s.noNewRows,
        read: async () => {
          const v = await call(p.id, s.read, {});
          return (Array.isArray(v) ? v : []).slice(0, 5000).flatMap((r): SourceRecord[] => {
            const o = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
            if (!o || !str(o.ref) || !str(o.title)) return [];
            const fields: Record<string, string> = {};
            if (o.fields && typeof o.fields === "object") for (const [k, x] of Object.entries(o.fields as Record<string, unknown>)) fields[k.slice(0, 60)] = str(x, 2000);
            return [{ ref: str(o.ref, 200), title: str(o.title, 300), ...(str(o.key) ? { key: str(o.key, 60) } : {}), fields, ...(str(o.text, 20000) ? { text: str(o.text, 20000) } : {}), ...(/^https?:\/\//.test(str(o.url)) ? { url: str(o.url, 1000) } : {}), ...(str(o.updatedAt) ? { updatedAt: str(o.updatedAt, 40) } : {}) }];
          });
        },
      }),
    ),
  );
}
