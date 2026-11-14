import { getPref } from "@/lib/prefs";
import { stepMinutes } from "@/lib/sync/intervals";

const PORT = "google-calendar-ext";
const FLOW = "google-calendar.sync";

/**
 * From the built-in Google Calendar to the plugin (zeff-plugins/plugins/google-calendar-ext): the plugin on, its package installed under
 * System — the sync flow, allowed to read Google Calendar into Zeff (its `sync` permission: your click is the yes), running as often as the
 * built-in did —, the built-in off. Reading Google stays the kernel's driver (lib/google/calendar-sync.ts); your calendars, the
 * Connections page's choice (API or Chrome) and the calendar settings (weeks, account) stay as they are, and so does everything that asks
 * for Google Calendar (state.ts PROVIDED_BY: the built-in counts as there through its port). Server only.
 */
export async function switchGoogleCalendarToPlugin(): Promise<{ flow: string }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Google Calendar plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const minutes = stepMinutes("gcalendar");
  reg.setEnabled(PORT, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName(FLOW)) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Google Calendar plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  // (as often as the built-in synced — by hand only stays by hand)
  flows.setSyncFlowMinutes(FLOW, minutes);
  (await import("@/plugins/state")).setInstalled("google-calendar", false);
  return { flow: FLOW };
}
