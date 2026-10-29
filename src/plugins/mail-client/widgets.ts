import { getSqlite } from "@/db";
import { formatSmart } from "@/lib/format";
import { CHAT_FOLDERS } from "@/lib/mail/shared";
import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { clip, initials } from "@/plugins/workspace/widget-shared";
import { getDatabase, tree, unreadCounts } from "@/plugins/workspace/store";

/** The inbox that holds most of what is unread (the link the widget leads to), or none. */
function mainInbox(): { id: number; n: number } | null {
  const counts = unreadCounts();
  const best = tree()
    .filter((x) => x.kind === "database" && (counts[x.id] ?? 0) > 0)
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))[0];
  return best ? { id: best.id, n: counts[best.id] } : null;
}

type Mail = { key: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string; folder: string };

/** The newest unread mail and chats — who, what, when — and the inbox they are in; "read again" runs the inboxes' pipelines. */
export const MAIL_WIDGETS: WorkspaceWidget[] = [
  {
    id: "mail.unread",
    get label() {
      return t("Unread");
    },
    icon: "📬",
    get description() {
      return t("The newest unread mail and chats — who wrote, about what, when — and a way into your inbox.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 20 },
        {
          key: "show",
          label: t("Show"),
          kind: "select",
          default: "messages",
          options: [
            { value: "messages", label: t("The messages") },
            { value: "inboxes", label: t("The inboxes with their counts") },
          ],
        },
      ];
    },
    ttl: 20,
    data: (config) => {
      const inbox = mainInbox();
      const href = inbox ? `/workspace/${inbox.id}` : "/workspace";
      if (config.show === "inboxes") {
        const counts = unreadCounts();
        const items = tree()
          .filter((x) => x.kind === "database" && (counts[x.id] ?? 0) > 0)
          .map((x) => ({ id: String(x.id), icon: x.icon || "📥", text: x.title || t("Untitled"), meta: String(counts[x.id]), href: `/workspace/${x.id}`, actions: [{ id: "refresh", label: t("Read again"), icon: "↻" }] }))
          .sort((a, b) => Number(b.meta) - Number(a.meta));
        return { kind: "list", items, empty: t("Nothing unread.") };
      }
      const db = getSqlite();
      // (the chats, WhatsApp and Signal, are kept with the mails: not mails)
      const where = `unread = 1 and resolved_at is null and folder not like '%Archive%' and folder not like '%Archiv%' and folder not like '%Sent%' and folder not like '%Gesendet%' and folder not in (${CHAT_FOLDERS.map((f) => `'${f}'`).join(", ")})`;
      const total = (db.prepare(`select count(*) as n from emails where ${where}`).get() as { n: number }).n;
      const mails = db.prepare(`select key, from_name, from_email, subject, preview, received_at, folder from emails where ${where} order by received_at desc limit ?`).all(Number(config.limit)) as Mail[];
      return {
        kind: "list",
        count: total,
        items: mails.map((m) => ({
          id: m.key,
          icon: initials(m.from_name || m.from_email) || "✉",
          text: m.subject || clip(m.preview, 80),
          detail: [m.from_name || m.from_email, clip(m.preview, 90)].filter(Boolean).join(" — "),
          meta: formatSmart(m.received_at),
          href,
        })),
        empty: t("Nothing unread. ✓"),
        footer: total > mails.length ? { text: t("{n} more in the inbox", { n: total - mails.length }), href } : undefined,
      };
    },
    act: async (action, payload) => {
      if (action !== "refresh") throw new Error("unknown action");
      const id = Number(payload.id);
      if (!getDatabase(id)) throw new Error(t("No such database."));
      await (await import("@/plugins/workspace/pipeline")).startPipeline(id, { ai: false }).done;
    },
  },
];
