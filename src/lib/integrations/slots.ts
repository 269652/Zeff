import type { PluginId } from "@/plugins/catalog";
import { installedPlugins } from "@/plugins/state";
import { integrationServer, integrationServerIds } from "./server";
import type { IntegrationMarks, JobsSlot, MonthContext, MonthSlot, WeekContext, WeekSlot } from "./types";

/** What the installed plugins of the mounted integrations add to the week's page, each by its id (the order they are mounted in). */
export async function weekSlots(ctx: WeekContext): Promise<{ id: string; slot: WeekSlot }[]> {
  const on = installedPlugins();
  const ids = integrationServerIds().filter((id) => on.has(id as PluginId) && integrationServer(id)?.week);
  return Promise.all(ids.map(async (id) => ({ id, slot: (await integrationServer(id)!.week!(ctx)) ?? {} })));
}

/** The data they hand to the week's tables (marks per entry and per day). */
export const marksOf = (slots: { id: string; slot: WeekSlot }[]): IntegrationMarks => Object.fromEntries(slots.map(({ id, slot }) => [id, { entries: slot.entries, days: slot.days }]));

/** The same for the month's page. */
export async function monthSlots(ctx: MonthContext): Promise<{ id: string; slot: MonthSlot }[]> {
  const on = installedPlugins();
  const ids = integrationServerIds().filter((id) => on.has(id as PluginId) && integrationServer(id)?.month);
  return Promise.all(ids.map(async (id) => ({ id, slot: (await integrationServer(id)!.month!(ctx)) ?? {} })));
}

/** What the installed plugins of the mounted integrations add to the jobs page. */
export function jobsSlots(): { id: string; slot: JobsSlot }[] {
  const on = installedPlugins();
  return integrationServerIds().flatMap((id) => {
    const slot = integrationServer(id)?.jobs;
    return slot && on.has(id as PluginId) ? [{ id, slot }] : [];
  });
}
