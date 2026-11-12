import crypto from "node:crypto";
import { t } from "@/lib/i18n/server";
import { getDatabase, updateSchema } from "./store";
import { viewAppMeta } from "./view-apps";

const hashOf = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/**
 * An app's view keeps its own copy of the app's template (in the database, where you and the AI change it, every change kept as a version —
 * store.ts ws_view_versions). Copied the first time the database is opened; a copy nobody changed follows the app's own template when that
 * changes (Zeff updated, another language) — one that was changed stays yours. Server only.
 */
export function ensureAppTemplates(dbId: number): void {
  const db = getDatabase(dbId);
  if (!db) return;
  let dirty = false;
  const views = db.schema.views.map((v) => {
    if (v.type !== "app" || !v.app) return v;
    const meta = viewAppMeta(v.app);
    if (!meta) return v;
    const def = meta.defaultTemplate(t);
    const base = hashOf(def);
    const untouched = !v.template || (!!v.templateBase && hashOf(v.template) === v.templateBase);
    if (!untouched || (v.template && v.templateBase === base)) return v;
    dirty = true;
    return { ...v, template: def, templateBase: base };
  });
  if (dirty) updateSchema(dbId, { ...db.schema, views });
}
