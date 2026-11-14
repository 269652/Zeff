import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import type { View } from "@/plugins/workspace/model";
import { getDatabase, updateSchema } from "@/plugins/workspace/store";
import { MAIL_PORT, toPortMail, type MailApp } from "./port.meta";
import { CHAT_VIEW, INBOX_VIEW, MAIL_VIEW } from "./view-template.meta";

const DEFAULTS: Record<MailApp, (tt: typeof t) => string> = { mail: MAIL_VIEW.defaultTemplate, chat: CHAT_VIEW.defaultTemplate, inbox: INBOX_VIEW.defaultTemplate };

/**
 * From the built-in Mail & Chat to the plugin (zeff-plugins/plugins/mail-client-ext): every mail, chat and inbox view of this Zeff gets the
 * port's screen — its own template turned into view language (toPortMail: what you changed in it stays) —, the plugin on, the built-in
 * off. New inboxes get the plugin's views (its contributes.appViews). Your mails, chats, inboxes and their pipelines stay as they are.
 * Needs the plugin in the plugins folder. Server only.
 */
export async function switchMailClientToPlugin(): Promise<{ views: number }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === MAIL_PORT.plugin)) throw new Error(`The Mail & Chat plugin (${MAIL_PORT.plugin}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and template = 0").all() as { id: number }[]).map((r) => r.id);
  let views = 0;
  for (const id of ids) {
    const d = getDatabase(id);
    if (!d) continue;
    let changed = false;
    const next = d.schema.views.map((v): View => {
      const app = v.type === "app" && (v.app === "mail" || v.app === "chat" || v.app === "inbox") ? (v.app as MailApp) : null;
      if (!app) return v;
      changed = true;
      views++;
      return { ...v, app: "template", template: toPortMail(v.template?.trim() ? v.template : DEFAULTS[app](t), app, t) };
    });
    if (changed) updateSchema(id, { ...d.schema, views: next });
  }
  reg.setEnabled(MAIL_PORT.plugin, true);
  (await import("@/plugins/state")).setInstalled("mail-client", false);
  return { views };
}
