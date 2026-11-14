import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { appViewFields, appViewsFor } from "./app-views";
import { emptyFilter, newId, newView, removeProperty, type DbSchema, type View } from "./model";
import { createPage, getDatabase, updatePage, updateSchema } from "./store";

const INBOX = "workspace.docInboxDb";
const V2 = "workspace.docInboxDb.v2";

/** The database "Document inbox" - null: not made, or gone. */
export function documentInbox(): number | null {
  const id = getPref<number | null>(INBOX, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The unread documents: a view's filter on the Unread box. */
const unreadOnly = () => ({ ...emptyFilter(), rules: [{ prop: "docunread", cond: "checked" as const }] });
const byAdded = [{ prop: "docadded", dir: "desc" as const }];

/**
 * The documents as a database of the Workspace - once, when the Documents plugin is installed (a gone one isn't made again):
 * every document is a row (the documents source), shown first by the documents app (a drive: the inbox of what you have not
 * seen, all documents, by type, a preview) and as tables - "Inbox" (unread only), "All" - and a gallery. Opening a document's
 * file or ticking its Unread box off takes it out of the inbox; a new document (dropped in, a mail attachment) comes in by itself.
 */
export async function ensureDocumentDatabases(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("documents")) return;
  const known = documentInbox();
  if (known) {
    mend(known);
    // Opening the Workspace reads it again when the last read is a while ago (what came while it was away, a mended database).
    const ran = Date.parse(getDatabase(known)?.schema.pipeline?.ranAt ?? "");
    if (!ran || Date.now() - ran > 2 * 60000) refreshDocumentDatabases();
    return;
  }
  if (getPref<number | null>(INBOX, null) !== null) return;
  const app = appViewsFor("documents")[0];
  const views: View[] = [
    ...(app ? [{ ...newView(t(app.label), "table"), ...appViewFields(app) }] : []),
    { ...newView(t("Inbox"), "table"), filter: unreadOnly(), sorts: byAdded },
    { ...newView(t("All"), "table"), sorts: byAdded },
    newView(t("Gallery"), "gallery"),
  ];
  const schema: DbSchema = {
    titleName: t("Name"),
    properties: [],
    views,
    dataType: "documents",
    pipeline: { everyMinutes: 10, steps: [{ id: newId("s"), kind: "source", from: "ext", ext: "documents" }] },
  };
  const id = createPage({ kind: "database", title: t("Document inbox"), icon: "📥", schema });
  updatePage(id, { fullWidth: true, favorite: true });
  setPref(INBOX, id);
  setPref(V2, true);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}

/**
 * The first version of the inbox was one table that a filter step kept to the unread ones: now the database holds every document
 * (the app and "All" show them, "Inbox" is a view of the unread ones). Once; and the app view where it is missing.
 */
function mend(id: number): void {
  const cur = getDatabase(id)!.schema;
  let next: DbSchema = cur;
  // Turned into a mail inbox (the View menu's "Inbox" names mail and chats as sources, drops the type and the app): back to the documents.
  const foreign = (cur.pipeline?.steps ?? []).some((s) => s.kind === "source" && (s.from === "mail" || s.from === "messages"));
  if (foreign || cur.dataType !== "documents") {
    let schema: DbSchema = { ...cur, dataType: "documents" as const, views: cur.views.filter((v) => !(v.type === "app" && v.app !== "documents")), ...(cur.pipeline ? { pipeline: { ...cur.pipeline, steps: cur.pipeline.steps.filter((s) => !(s.kind === "source" && (s.from === "mail" || s.from === "messages"))) } } : {}) };
    for (const p of cur.properties) if (p.id.startsWith("comm")) schema = removeProperty(schema, p.id);
    next = schema;
  }
  if (!getPref<boolean>(V2, false)) {
    const steps = (next.pipeline?.steps ?? []).filter((s) => !(s.kind === "filter" && (s.rules ?? []).some((r) => r.field === "Unread")));
    const views = next.views.map((v) => (v.type === "table" && v.name === t("Table") ? { ...v, name: t("All") } : v));
    next = { ...next, views: [{ ...newView(t("Inbox"), "table"), filter: unreadOnly(), sorts: byAdded }, ...views], ...(next.pipeline ? { pipeline: { ...next.pipeline, steps } } : {}) };
    setPref(V2, true);
  }
  const app = appViewsFor("documents")[0];
  if (app && !next.views.some((v) => v.type === "app" && v.app === app.id)) next = { ...next, views: [{ ...newView(t(app.label), "table"), ...appViewFields(app) }, ...next.views] };
  if (next !== cur) {
    updateSchema(id, next);
    // What the database got wrongly (mail rows) goes at the next read: now.
    refreshDocumentDatabases();
  }
}

/** The documents databases read again - a document came, was opened or marked (in the background). */
export function refreshDocumentDatabases(): void {
  const id = documentInbox();
  if (!id) return;
  void import("./pipeline").then((p) => p.startPipeline(id, { ai: false })).catch(() => undefined);
}
