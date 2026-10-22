import type { T } from "@/lib/i18n/shared";
import type { PreviewLine } from "@/plugins/workspace/doc";
import type { Row } from "@/plugins/workspace/model";
import { DOC_KINDS_NAV, docNav, factsOf, inScope } from "./nav";

/**
 * What the documents view's template reads as app.* (view-template.ts): the documents of the scope asked for, searched and sorted —
 * the rows themselves, so a list of them picks and its buttons act on them —, the scopes as tab options with their counts, the
 * document picked written out, the ticked ones counted. Worked out here because the language's filters take fixed words, not the
 * view's state. Client-safe.
 */

export type DocSort = "newest" | "oldest" | "name" | "size" | "unread";

/** A document row's document (its source reference "doc:12") — 0: a row of none. */
export const docIdOf = (row: Row): number => Number(/^doc:(\d+)$/.exec(String(row.cells.srcref ?? ""))?.[1] ?? 0);

/** The ids ticked (state.checked: "3,7,9"). */
export const checkedIds = (s: string | undefined): number[] => (s ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);

const textOf = (lines: PreviewLine[] | undefined) => (lines ?? []).flatMap((l) => (l.kind === "text" ? [l.text] : []));
const conceptsOf = (row: Row) => String(row.cells.docconcepts ?? "").split(",").map((x) => x.trim()).filter(Boolean);
// (A tab's option is "value:Label, …" — a label keeps neither.)
const optionLabel = (s: string) => s.replace(/[,:]/g, " ").trim();
/** A scope as a tab's value ("kind:pdf" → "kind-pdf": a value keeps no colon) — and back. */
export const scopeTab = (id: string) => id.replace(/^kind:/, "kind-");
export const scopeOf = (s: string | undefined) => (s || "inbox").replace(/^kind-/, "kind:");

export function documentsAppData(rows: Row[], v: { state: Record<string, string>; previews?: Record<number, PreviewLine[]>; t: T; now: number; inTree?: boolean; locale?: string; /** The documents (their ids) whose whole text holds what was searched — the server's answer. */ matches?: Set<number> }): Record<string, unknown> {
  const { t, state, now } = v;
  const docs = rows.filter((r) => docIdOf(r) > 0);
  const scope = scopeOf(state.scope);
  const sort = (state.sort || "newest") as DocSort;
  const w = (state.q ?? "").trim().toLowerCase();
  const added = (r: Row) => String(r.cells.docadded ?? "");
  const unread = (r: Row) => r.cells.docunread === true;
  const size = (r: Row) => Number(r.cells.docsize ?? 0);
  const hay = (r: Row) => [r.title, String(r.cells.docfrom ?? ""), ...conceptsOf(r), ...textOf(v.previews?.[r.id])].join(" ").toLowerCase();
  const cmp: Record<DocSort, (a: Row, b: Row) => number> = {
    newest: (a, b) => added(b).localeCompare(added(a)),
    oldest: (a, b) => added(a).localeCompare(added(b)),
    name: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => size(b) - size(a),
    unread: (a, b) => Number(unread(b)) - Number(unread(a)) || added(b).localeCompare(added(a)),
  };
  const shown = docs.filter((r) => inScope(factsOf(r.cells), scope, now) && (!w || hay(r).includes(w) || !!v.matches?.has(docIdOf(r)))).sort(cmp[sort] ?? cmp.newest);
  const nav = docNav(docs.map((r) => factsOf(r.cells)), t, now);
  const picked = shown.find((r) => String(r.id) === state.selected) ?? null;
  const ids = new Set(docs.map((r) => r.id));
  const checkedCount = checkedIds(state.checked).filter((id) => ids.has(id)).length;
  const inbox = nav.find((e) => e.id === "inbox")?.n ?? 0;
  const pickedOf = (r: Row) => {
    const status = String(r.cells.docstatus ?? "");
    const at = added(r);
    const kind = DOC_KINDS_NAV[String(r.cells.dockind ?? "")] ?? DOC_KINDS_NAV.other;
    return {
      id: docIdOf(r),
      kind: t(kind.label),
      added: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleString(v.locale) : "",
      state: status === "ready" ? (r.cells.doccompiled === true ? t("Read and compiled") : t("Read")) : t(status),
      abstract: textOf(v.previews?.[r.id]).slice(0, 4).join(" ").replace(/^#+\s*/, "").slice(0, 600),
      concepts: conceptsOf(r).slice(0, 12),
    };
  };
  return {
    scope,
    inTree: !!v.inTree,
    showScopes: !v.inTree,
    scopeOptions: nav.map((e) => `${scopeTab(e.id)}:${optionLabel(`${e.icon} ${e.label}${e.n > 0 ? ` ${e.n}` : ""}`)}`).join(", "),
    shown,
    count: shown.length,
    hasPicked: !!picked,
    picked: picked ? pickedOf(picked) : null,
    checkedCount,
    markAll: scope === "inbox" && inbox > 0,
    emptyIcon: scope === "inbox" ? "🎉" : "🗂️",
    emptyText: scope === "inbox" ? t("Nothing new — everything is read.") : w ? t("Nothing matches.") : t("No documents here yet."),
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const DOCUMENTS_APP_DATA =
  "app.shown (the documents of the scope, searched and sorted — rows: a list of them picks with select=true; their properties by id: dockind (pdf|office|text|image|audio|other), docstatus (ready|queued|extracting|failed|unsupported), docadded, docsize (KB), docunread, doccompiled, docfrom, docconcepts), app.count, app.scope, app.scopeOptions (the scopes as <tabs> options, with their counts), app.showScopes (false: the scopes are in the Workspace tree), app.inTree, app.hasPicked, app.picked (the document picked and shown: id (the document's), kind, added, state, abstract, concepts), app.checkedCount (the documents ticked), app.markAll (an inbox with something in it), app.emptyIcon, app.emptyText. State: state.scope (inbox|all|week|mail|processing|kind-pdf …), state.q, state.sort (newest|oldest|unread|name|size), state.layout (grid|list), state.selected (the row picked), state.checked (the rows ticked: \"3,7\"), state.busy.";
