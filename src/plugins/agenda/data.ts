import { t } from "@/lib/i18n/server";

export type AgendaAppData = { projects: { id: number; title: string; icon: string; category: string; open: number }[]; events: { title: string; time: string }[]; upgraded: boolean };

/**
 * What Agenda's screen shows besides its notes: the projects by category (the archived ones not) with their open notes, and today's
 * events of the calendar. The database brought up to date first (an older Agenda: its reminder, its type, its screen — upgrade.ts).
 */
export async function agendaData(dbId: number): Promise<AgendaAppData> {
  const store = await import("@/plugins/workspace/store");
  const { ensureAgenda } = await import("./upgrade");
  const { dateRange, todoColumns } = await import("@/plugins/workspace/model");
  const upgraded = ensureAgenda(Number(dbId));
  if (upgraded) (await import("@/plugins/workspace/todo-engine")).syncDatabase(Number(dbId));
  const d = store.getDatabase(Number(dbId));
  if (!d) throw new Error(t("The database is gone."));
  const rel = d.schema.properties.filter((p) => p.type === "relation" && p.relationDb !== undefined);
  const projectProp = rel.find((p) => (store.getDatabase(p.relationDb!)?.schema.dataType ?? "") !== "calendar");
  const done = todoColumns(d.schema)?.done;
  const notes = store.rawRows(d.page.id);
  const projects: AgendaAppData["projects"] = [];
  if (projectProp) {
    const pd = store.getDatabase(projectProp.relationDb!);
    const category = pd?.schema.properties.find((p) => p.type === "select");
    const archived = pd?.schema.properties.find((p) => p.type === "checkbox");
    for (const r of pd ? store.rawRows(pd.page.id) : []) {
      if (archived && r.cells[archived.id] === true) continue;
      const cat = category?.options?.find((o) => o.id === r.cells[category.id])?.name ?? t("Without a category");
      const mine = notes.filter((n) => ((n.cells[projectProp.id] as number[] | undefined) ?? []).includes(r.id));
      const open = mine.filter((n) => !(done && n.cells[done.id] === true)).length;
      // (A project whose notes are all done isn't offered — as in Agenda; an empty one is, to write in.)
      if (mine.length && !open) continue;
      projects.push({ id: r.id, title: r.title || t("Untitled"), icon: r.icon || "📁", category: cat, open });
    }
    projects.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }
  // Today's events: the calendar's rows dated today.
  const events: AgendaAppData["events"] = [];
  const today = new Date().toLocaleDateString("sv-SE");
  const cal = rel.find((p) => store.getDatabase(p.relationDb!)?.schema.dataType === "calendar");
  const cd = cal ? store.getDatabase(cal.relationDb!) : null;
  const when = cd?.schema.properties.find((p) => p.type === "date");
  if (cd && when) {
    for (const r of store.rawRows(cd.page.id)) {
      const range = dateRange(r.cells[when.id]);
      if (!range) continue;
      // (A time is the moment, in this computer's zone: its day and hour as they are here.)
      const local = (v: string) => (v.includes("T") ? new Date(v) : null);
      const dayOf = (v: string) => local(v)?.toLocaleDateString("sv-SE") ?? v.slice(0, 10);
      if (dayOf(range.start) > today || dayOf(range.end ?? range.start) < today) continue;
      const at = local(range.start);
      const time = at && dayOf(range.start) === today ? at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : t("all day");
      events.push({ title: r.title || t("Untitled"), time });
    }
    events.sort((a, b) => a.time.localeCompare(b.time));
  }
  return { projects, events, upgraded };
}
