import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import type { View } from "@/plugins/workspace/model";
import { getDatabase, updateSchema } from "@/plugins/workspace/store";
import { fieldsOf, isAgendaDb } from "./upgrade";
import { ADD_NOTE_FLOW, AGENDA_PORT, toPortScreen } from "./view-template.meta";

/**
 * From the built-in Agenda to the plugin (zeff-plugins/plugins/agenda-ext): every Agenda of this Zeff gets the port's screen — its own
 * template turned into view language (toPortScreen: what you changed in it stays) —, the flow that adds a note may write them, the plugin
 * on, the built-in off. Your notes, projects and fields stay as they are. Needs the plugin in the plugins folder. Server only.
 */
export async function switchAgendaToPlugin(): Promise<{ agendas: number }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === AGENDA_PORT.plugin)) throw new Error(`The Agenda plugin (${AGENDA_PORT.plugin}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0").all() as { id: number }[]).map((r) => r.id);
  const agendas: number[] = [];
  for (const id of ids) {
    const d = getDatabase(id);
    if (!d || !isAgendaDb(d.schema)) continue;
    const { names } = fieldsOf(d.schema);
    const views = d.schema.views.map((v): View => (v.app === "agenda" || v.template?.includes('name="agenda.new"') ? { ...v, app: "template", template: toPortScreen(v.template ?? "", names, t) } : v));
    updateSchema(id, { ...d.schema, views });
    agendas.push(id);
  }
  // The flow that adds a note: one there (from the package) may write these too; none: made, allowed for them — your click is the yes.
  const flows = await import("@/plugins/workspace/flows/store");
  const have = flows.flowByName(AGENDA_PORT.addNote);
  if (have) {
    const w = have.permissions.write;
    if (w !== "all") flows.saveFlow(have.pageId, { ...have, permissions: { ...have.permissions, write: [...new Set([...(w ?? []), ...agendas])] } });
  } else if (agendas.length) {
    const parent = getDatabase(agendas[0])?.page.parentId ?? null;
    flows.createFlow({ ...ADD_NOTE_FLOW, permissions: { write: agendas } }, parent);
  }
  reg.setEnabled(AGENDA_PORT.plugin, true);
  (await import("@/plugins/state")).setInstalled("agenda", false);
  return { agendas: agendas.length };
}
