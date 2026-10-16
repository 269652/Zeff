import { t } from "@/lib/i18n/server";
import { appViewsFor } from "./app-views";
import { newId, newView, type DataType, type DbSchema, type PipelineSource, type PipelineStep, type View } from "./model";
import { createPage, getDatabase, updatePage } from "./store";

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

const SOURCE_TITLES: Record<Exclude<PipelineSource, "database">, string> = { jira: "Jira tickets", keep: "Google Keep notes", todos: "Todos", mail: "Mails", messages: "Messages" };
const SOURCE_TYPE: Partial<Record<PipelineSource, DataType>> = { mail: "mail", messages: "message" };

/** A database straight from a data source (Jira, Google Keep, todos, mail, messages): its pipeline that source — more steps to add (filters, AI). */
export function createSourceDatabase(from: Exclude<PipelineSource, "database">, title?: string): number {
  const dataType = SOURCE_TYPE[from];
  const app = appViewsFor(dataType)[0];
  const step: PipelineStep = { id: newId("s"), kind: "source", from, ...(from === "jira" ? { jira: { mine: true, openOnly: true } } : from === "mail" ? { mail: { recentDays: 30 } } : from === "messages" ? { messages: { recentDays: 14 } } : {}) };
  const views: View[] = [...(app ? [{ ...newView(t(app.label), "table"), type: "app" as const, app: app.id }] : []), from === "jira" || from === "todos" ? newView(t("Board"), "board") : from === "keep" ? newView(t("Notes"), "gallery") : newView(t("Table"), "table")];
  const schema: DbSchema = { titleName: t("Name"), properties: [], views, ...(dataType ? { dataType } : {}), pipeline: { steps: [step] } };
  const id = createPage({ kind: "database", title: title || t(SOURCE_TITLES[from]), schema });
  updatePage(id, { fullWidth: true });
  return id;
}
