import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { newProperty, type DbSchema, type Property, type View } from "@/plugins/workspace/model";
import { getDatabase, updateSchema } from "@/plugins/workspace/store";
import { AGENDA_VERSION, agendaNames, agendaScreen, type AgendaNames } from "./view-template.meta";

/**
 * An Agenda's notes database brought to what the Agenda plugin has now — one made by an older version too (it had no data type, its
 * screen was a view of any table): its fields found (by their names in your language, else by their kind), a reminder (a note with
 * one is a todo of that day — in the Todos, ticked both ways) and an event of the calendar where there is one added, the data type
 * set (its checklists are todos), its screen redrawn when it is still one the plugin made (an older version of it). Server only.
 */

const MARK = 'name="agenda.new"';

/** The calendar database (the Calendar plugin's), if there is one. */
function calendarDb(): number | null {
  const r = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0 and json_extract(schema, '$.dataType') = 'calendar' order by id limit 1").get() as { id: number } | undefined;
  return r?.id ?? null;
}

/** Whether a database is an Agenda's notes: its type says so, or one of its views is the Agenda's screen. */
export function isAgendaDb(schema: DbSchema): boolean {
  return schema.dataType === "agenda" || schema.views.some((v) => !!v.template?.includes(MARK));
}

/** The fields the screen goes by, found in a schema: by name, else by kind (the first date, relation, checkboxes in their order). */
function fieldsOf(schema: DbSchema): { names: AgendaNames; date?: Property; done?: Property; reminder?: Property; event?: Property } {
  const want = agendaNames(t);
  const props = schema.properties;
  const named = (name: string, type: Property["type"] | Property["type"][]) => props.find((p) => p.name.toLowerCase() === name.toLowerCase() && ([] as string[]).concat(type).includes(p.type));
  const boxes = props.filter((p) => p.type === "checkbox");
  const date = named(want.date, "date") ?? props.find((p) => p.type === "date" && p.name !== want.reminder);
  const project = named(want.project, "relation") ?? props.find((p) => p.type === "relation" && p.name !== want.event);
  const agenda = named(want.agenda, "checkbox") ?? boxes[0];
  const pinned = named(want.pinned, "checkbox") ?? boxes[1];
  const done = named(want.done, "checkbox") ?? boxes[2];
  const tags = named(want.tags, "multi_select") ?? props.find((p) => p.type === "multi_select" && p.name !== want.people);
  const people = named(want.people, ["person", "multi_select"]) ?? props.find((p) => p.type === "person");
  const reminder = named(want.reminder, "date");
  const event = named(want.event, "relation");
  return {
    names: { date: date?.name ?? want.date, project: project?.name ?? want.project, agenda: agenda?.name ?? want.agenda, pinned: pinned?.name ?? want.pinned, done: done?.name ?? want.done, tags: tags?.name ?? want.tags, people: people?.name ?? want.people, reminder: reminder?.name ?? want.reminder, event: event ? event.name : "" },
    date,
    done,
    reminder,
    event,
  };
}

/** The notes database brought up to date. Whether anything changed. */
export function ensureAgenda(dbId: number): boolean {
  const d = getDatabase(dbId);
  if (!d || !isAgendaDb(d.schema)) return false;
  let schema: DbSchema = d.schema;
  const add = (p: Property) => (schema = { ...schema, properties: [...schema.properties, p] });
  let found = fieldsOf(schema);
  if (!found.reminder) add({ ...newProperty(found.names.reminder, "date"), includeTime: true });
  const cal = calendarDb();
  if (!found.event && cal) add({ ...newProperty(agendaNames(t).event, "relation"), relationDb: cal });
  found = fieldsOf(schema);
  const screen = agendaScreen(found.names, t);
  const views = schema.views.map((v): View => {
    if (!v.template?.includes(MARK)) return v;
    // A screen of an older version: the current one. One of this version stays as it is (you may have changed it).
    const old = !v.template.includes(`<state name="v" value="${AGENDA_VERSION}"/>`);
    return { ...v, app: "agenda", ...(old ? { template: screen } : {}) };
  });
  schema = {
    ...schema,
    views,
    dataType: "agenda",
    ...(found.done && found.reminder ? { todoList: { done: found.done.id, due: found.reminder.id, engine: true, dated: true } } : {}),
  };
  if (JSON.stringify(schema) === JSON.stringify(d.schema)) return false;
  updateSchema(dbId, schema);
  return true;
}

/** Every Agenda of this Zeff brought up to date (the plugin's start, an upgrade). How many changed. */
export async function ensureAgendas(): Promise<number> {
  const ids = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0 and (json_extract(schema, '$.dataType') = 'agenda' or instr(schema, 'agenda.new') > 0)").all() as { id: number }[];
  let n = 0;
  for (const { id } of ids) if (ensureAgenda(id)) n++;
  if (n) {
    const { syncDatabase } = await import("@/plugins/workspace/todo-engine");
    for (const { id } of ids) syncDatabase(id);
  }
  return n;
}
