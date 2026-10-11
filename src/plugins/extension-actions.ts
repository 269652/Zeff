"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { catalogText } from "./catalog-text";
import { setExtensionInstalled } from "./extension-state";

/** Turn an extension on or off (Plugins page). */
export async function setExtensionInstalledAction(id: string, installed: boolean): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const ext = setExtensionInstalled(String(id), !!installed);
    // Knowledge, steps, menus: the whole app may change.
    revalidatePath("/", "layout");
    const name = catalogText(t, ext.name);
    return { ok: true, message: installed ? t("{name} on.", { name }) : t("{name} off.", { name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
