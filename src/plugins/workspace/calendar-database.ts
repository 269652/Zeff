import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { appViewsFor } from "./app-views";
import { newView } from "./model";
import { getDatabase, updatePage, updateSchema } from "./store";

const CALENDAR = "workspace.calendarDb";

/** The database "Calendar" — null: not made, or gone. */
export function calendarDatabase(): number | null {
  const id = getPref<number | null>(CALENDAR, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The calendar's rows read again from its model (after a change in the calendar app, a sync, an edit elsewhere) - in the background. */
export function refreshCalendarDatabase(): void {
  const id = calendarDatabase();
  if (!id) return;
  void import("./pipeline").then((p) => p.startPipeline(id, { ai: false })).catch(() => undefined);
}

/**
 * Your calendar as a database of the Workspace — once, when the Calendar plugin is installed (a gone one isn't made again): its
 * appointments are the rows, the calendar app is its first view. The calendar's own tables stay where free times, meeting
 * suggestions and booking read them.
 */
export async function ensureCalendarDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("calendar")) return;
  const known = calendarDatabase();
  if (known) {
    // Mended where it is incomplete: its data type (the app views of a database go by it) and the calendar view first (a database made
    // before the view existed, or while the plugin wasn't ready, shows only a table).
    const cur = getDatabase(known)!.schema;
    const app = appViewsFor("calendar")[0];
    const typed = cur.dataType === "calendar" ? cur : { ...cur, dataType: "calendar" as const };
    const views = app && !typed.views.some((v) => v.type === "app" && v.app === app.id) ? [{ ...newView(t(app.label), "table"), type: "app" as const, app: app.id }, ...typed.views] : typed.views;
    if (typed !== cur || views !== typed.views) updateSchema(known, { ...typed, views });
    return;
  }
  if (getPref<number | null>(CALENDAR, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("calendar", t("Calendar"));
  setPref(CALENDAR, id);
  // In the sidebar's favorites (it replaces the menu entry), read every 15 minutes besides at every change.
  updatePage(id, { favorite: true });
  // Its table by when things start.
  const cur = getDatabase(id)!.schema;
  updateSchema(id, { ...cur, views: cur.views.map((v) => (v.type === "table" ? { ...v, sorts: [{ prop: "calstart", dir: "asc" as const }] } : v)), pipeline: cur.pipeline ? { ...cur.pipeline, everyMinutes: 15 } : cur.pipeline });
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}
