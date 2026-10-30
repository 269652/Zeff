"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getPlugin, setEnabled } from "@/lib/ext/registry";
import { extWorkCommands, type WorkCommand } from "@/lib/ext/work";

/** Server Actions of the external plugin system (src/lib/ext). */

/** Turn an external plugin on — granting the permissions its manifest asks for — or off (Plugins page). */
export async function setExtPluginEnabledAction(id: string, on: boolean): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const plugin = getPlugin(String(id));
    if (!plugin) return { ok: false, error: t("This plugin isn't in the plugins folder any more.") };
    setEnabled(plugin.id, !!on);
    // Work's sidebar, the message box's commands, the panels: the whole app may change.
    revalidatePath("/", "layout");
    return { ok: true, message: on ? t("{name} on.", { name: plugin.manifest.name }) : t("{name} off.", { name: plugin.manifest.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The "/" commands of the Code message box (from the plugins that are on). */
export async function listWorkCommandsAction(): Promise<WorkCommand[]> {
  return extWorkCommands();
}
