import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { appViewsFor } from "./app-views";
import { newId, newView, type DataType, type DbSchema, type PipelineSource, type PipelineStep, type View } from "./model";
import { createPage, getDatabase, rawRows, tree, updatePage, updateSchema } from "./store";

/**
 * A database made from another, under it: its pipeline reads the other's rows with their fields as they are (a mail stays
 * a mail — shown by the same app), then an AI filter keeps what its instruction says ("important, urgent, or needs me to
 * act") — to change in its Sources & steps. The new database's id.
 */
export function createDerivedDatabase(fromId: number, title?: string): number {
  const from = getDatabase(fromId);
  if (!from) throw new Error(t("No such database."));
  const app = appViewsFor(from.schema.dataType)[0];
  const views: View[] = [...(app ? [{ ...newView(t(app.label), "table"), type: "app" as const, app: app.id }] : []), newView(t("Table"), "table")];
  const schema: DbSchema = {
    titleName: from.schema.titleName,
    properties: [],
    views,
    ...(from.schema.dataType ? { dataType: from.schema.dataType } : {}),
    pipeline: {
      // Its AI filter judges what's new after every sync of what it reads (once it has a condition).
      autoAi: true,
      steps: [
        { id: newId("s"), kind: "source", from: "database", dbId: fromId },
        // (No condition yet — whatever the rows are: it lets everything through until one is written or a prompt picked.)
        { id: newId("s"), kind: "ai", output: "filter" },
      ],
    },
  };
  const id = createPage({ kind: "database", parentId: fromId, title: title || t("{name} (filtered)", { name: from.page.title || t("Untitled") }), icon: from.page.icon, schema });
  updatePage(id, { fullWidth: true });
  return id;
}

const SOURCE_TITLES: Record<Exclude<PipelineSource, "database">, string> = { jira: "Jira tickets", keep: "Google Keep notes", todos: "Todos", mail: "Mails", messages: "Messages", knowledge: "Knowledge addresses" };
const SOURCE_TYPE: Partial<Record<PipelineSource, DataType>> = { mail: "mail", messages: "message" };

/** The channel sources an inbox names — mail and messages, those whose plugins are installed — leaving out the kinds already among `have`. */
function inboxSources(have: PipelineStep[]): PipelineStep[] {
  const has = (from: string) => have.some((s) => s.kind === "source" && s.from === from);
  return [
    ...(!has("mail") && (isInstalled("outlook-mail") || isInstalled("gmail")) ? [{ id: newId("s"), kind: "source" as const, from: "mail" as const, mail: { recentDays: 30 } }] : []),
    ...(!has("messages") && (isInstalled("teams") || isInstalled("whatsapp") || isInstalled("signal")) ? [{ id: newId("s"), kind: "source" as const, from: "messages" as const, messages: { recentDays: 14 } }] : []),
  ];
}

/** Which channel kinds can be sources now (their plugins installed): what "New → Inbox / Mail / Chat" offers. */
export function channelKinds(): { mail: boolean; messages: boolean } {
  const have = inboxSources([]);
  return { mail: have.some((s) => s.kind === "source" && s.from === "mail"), messages: have.some((s) => s.kind === "source" && s.from === "messages") };
}

/** Any database made an inbox: the channels named as its sources (the ones missing). Its Inbox view follows when it is read (run). */
export function makeInbox(dbId: number): void {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const steps = d.schema.pipeline?.steps ?? [];
  const add = inboxSources(steps);
  if (!add.length) return;
  updateSchema(dbId, { ...d.schema, pipeline: { ...d.schema.pipeline, steps: [...add, ...steps] } });
}

/** A database straight from a data source (Jira, Google Keep, todos, mail, messages): its pipeline that source — more steps to add (filters, AI). */
export function createSourceDatabase(from: Exclude<PipelineSource, "database"> | "inbox", title?: string): number {
  // A combined inbox: the mail source and the messages source together (the ones whose plugins are installed).
  if (from === "inbox") {
    const sources = inboxSources([]);
    const both = sources.length > 1;
    const app = appViewsFor(both ? "inbox" : sources[0]?.from === "mail" ? "mail" : "message")[0];
    const views: View[] = [...(app ? [{ ...newView(t(app.label), "table"), type: "app" as const, app: app.id }] : []), newView(t("Table"), "table")];
    const schema: DbSchema = { titleName: t("Subject"), properties: [], views, ...(both ? { dataType: "inbox" as const } : {}), pipeline: { steps: sources } };
    const id = createPage({ kind: "database", title: title || t("Inbox"), icon: "📬", schema });
    updatePage(id, { fullWidth: true });
    return id;
  }
  const dataType = SOURCE_TYPE[from];
  const app = appViewsFor(dataType)[0];
  const step: PipelineStep = { id: newId("s"), kind: "source", from, ...(from === "jira" ? { jira: { mine: true, openOnly: true } } : from === "mail" ? { mail: { recentDays: 30 } } : from === "messages" ? { messages: { recentDays: 14 } } : {}) };
  const views: View[] = [...(app ? [{ ...newView(t(app.label), "table"), type: "app" as const, app: app.id }] : []), from === "jira" || from === "todos" ? newView(t("Board"), "board") : from === "keep" ? newView(t("Notes"), "gallery") : newView(t("Table"), "table")];
  const schema: DbSchema = { titleName: t("Name"), properties: [], views, ...(dataType ? { dataType } : {}), pipeline: { steps: [step] } };
  const id = createPage({ kind: "database", title: title || t(SOURCE_TITLES[from]), schema });
  updatePage(id, { fullWidth: true });
  return id;
}

/** The database a derived one reads (its first source another database) — null: none. */
export const derivedFrom = (schema: DbSchema): number | null => {
  const first = schema.pipeline?.steps.find((s) => s.kind === "source");
  return first?.from === "database" && first.dbId ? first.dbId : null;
};

/**
 * A database's derived ones — under it, reading it ("Important" under Mail): each with how many rows and how many unread —
 * what an app shows as its folders (the mail client: extra folders).
 */
export function derivedOf(dbId: number): { id: number; title: string; icon: string; count: number; unread: number }[] {
  return tree()
    .filter((p) => p.parentId === dbId && p.kind === "database")
    .flatMap((p) => {
      const d = getDatabase(p.id);
      if (!d || derivedFrom(d.schema) !== dbId) return [];
      const rows = rawRows(p.id);
      return [{ id: p.id, title: p.title || t("Untitled"), icon: p.icon, count: rows.length, unread: rows.filter((r) => r.cells.mailunread === true).length }];
    });
}
