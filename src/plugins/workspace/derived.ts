import { t } from "@/lib/i18n/server";
import { appViewsFor } from "./app-views";
import { newId, newView, type DbSchema, type View } from "./model";
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
        { id: newId("s"), kind: "ai", output: "filter", prompt: "Behalte nur, was wichtig oder dringend ist oder bei dem ich handeln muss." },
      ],
    },
  };
  const id = createPage({ kind: "database", parentId: fromId, title: title || t("{name} (filtered)", { name: from.page.title || t("Untitled") }), icon: from.page.icon, schema });
  updatePage(id, { fullWidth: true });
  return id;
}
