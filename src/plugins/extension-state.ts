import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { EXTENSIONS, extensionById, extensionNeeds, extensionOfAction, extensionOfStep, type Extension } from "./extensions";
import { installedPlugins } from "./state";
import type { PluginId } from "./catalog";

/**
 * Which extensions are on (the account's): set as you set them — kept as rows "ext:<id>" in the
 * plugins table — else their default; and only while all their plugins are installed. Server only.
 */

const ROW = (id: string) => `ext:${id}`;

export type ExtensionState = {
  ext: Extension;
  /** All its plugins are installed — it shows (and can be turned on). */
  available: boolean;
  /** The plugins it still needs. */
  missing: PluginId[];
  /** On as you set it (else its default). */
  chosen: boolean;
  /** Available and on: what it brings is there. */
  installed: boolean;
};

export function extensionStates(): ExtensionState[] {
  const on = installedPlugins();
  const rows = EXTENSIONS.length ? getDb().select().from(schema.plugins).where(inArray(schema.plugins.id, EXTENSIONS.map((e) => ROW(e.id)))).all() : [];
  const set = new Map(rows.map((r) => [r.id, r.installed]));
  return EXTENSIONS.map((ext) => {
    const missing = extensionNeeds(ext).filter((p) => !on.has(p));
    const chosen = set.get(ROW(ext.id)) ?? ext.defaultInstalled;
    return { ext, available: !missing.length, missing, chosen, installed: !missing.length && chosen };
  });
}

export const installedExtensions = (): Set<string> => new Set(extensionStates().filter((s) => s.installed).map((s) => s.ext.id));

export const extensionInstalled = (id: string) => installedExtensions().has(id);

/** Turn one on or off (it stays set while its plugins come and go). */
export function setExtensionInstalled(id: string, installed: boolean): Extension {
  const ext = extensionById(id);
  if (!ext) throw new Error(t("Unknown extension."));
  const changedAt = new Date().toISOString();
  getDb().insert(schema.plugins).values({ id: ROW(id), installed, changedAt }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed, changedAt } }).run();
  emitChange("attention");
  return ext;
}

/** A sync step an extension brings: there only while it's on (true: the step isn't an extension's). */
export const stepExtensionOk = (step: string) => {
  const e = extensionOfStep(step);
  return !e || extensionInstalled(e.id);
};

/** An action an extension brings: offered and run only while it's on (true: not an extension's). */
export const actionExtensionOk = (type: string) => {
  const e = extensionOfAction(type);
  return !e || extensionInstalled(e.id);
};
