"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { setExtensionInstalled } from "./extension-state";

/** Turn an extension on or off (Plugins page). */
export async function setExtensionInstalledAction(id: string, installed: boolean): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const ext = setExtensionInstalled(String(id), !!installed);
    // Knowledge, steps, menus: the whole app may change.
    revalidatePath("/", "layout");
    return { ok: true, message: `${ext.name} ${installed ? "an" : "aus"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
