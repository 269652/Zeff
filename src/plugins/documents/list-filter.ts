/** The Documents list's search, filter and sort — pure, client-safe. */
import { DOC_KINDS, type DocKind, type DocView } from "./shared";

export const DOC_STATUS_FILTERS = ["all", "ready", "reading", "failed", "unsupported"] as const;
export type DocStatusFilter = (typeof DOC_STATUS_FILTERS)[number];
export const DOC_SORTS = ["newest", "name", "size"] as const;
export type DocSort = (typeof DOC_SORTS)[number];
export type DocKindFilter = "all" | DocKind;
export const isDocKindFilter = (v: string): v is DocKindFilter => v === "all" || (DOC_KINDS as readonly string[]).includes(v);

/** Ready, being read (waiting or reading), failed, not readable. */
export function statusMatches(status: DocView["status"], f: DocStatusFilter): boolean {
  if (f === "all") return true;
  if (f === "reading") return status === "queued" || status === "extracting";
  return status === f;
}

/** Every word of the query in the name, the abstract or the concepts. */
export function docMatches(d: DocView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [d.name, d.abstract, ...d.concepts].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterDocs(docs: DocView[], o: { query: string; status: DocStatusFilter; kind: DocKindFilter; sort: DocSort }): DocView[] {
  const sorts: Record<DocSort, (a: DocView, b: DocView) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id,
    size: (a, b) => b.size - a.size || a.id - b.id,
  };
  return docs.filter((d) => statusMatches(d.status, o.status) && (o.kind === "all" || d.kind === o.kind) && docMatches(d, o.query)).sort(sorts[o.sort]);
}
