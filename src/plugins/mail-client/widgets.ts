import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget } from "@/plugins/workspace/widget-point";
import { getDatabase, tree, unreadCounts } from "@/plugins/workspace/store";

/** The inboxes with their unread counts — "read again" runs the inbox's pipeline. */
export const MAIL_WIDGETS: WorkspaceWidget[] = [
  {
    id: "mail.unread",
    label: "Unread",
    icon: "📬",
    description: "Unread mail and chats by inbox — read the sources again from here.",
    ttl: 20,
    data: () => {
      const counts = unreadCounts();
      const items = tree()
        .filter((x) => x.kind === "database" && (counts[x.id] ?? 0) > 0)
        .map((x) => ({ id: String(x.id), text: x.title || t("Untitled"), badge: String(counts[x.id]), href: `/workspace/${x.id}`, actions: [{ id: "refresh", label: t("Read again") }] }))
        .sort((a, b) => Number(b.badge) - Number(a.badge));
      return { kind: "list", items, empty: t("Nothing unread."), title: items.length ? t("{n} unread", { n: items.reduce((n, i) => n + Number(i.badge), 0) }) : undefined };
    },
    act: async (action, payload) => {
      if (action !== "refresh") throw new Error("unknown action");
      const id = Number(payload.id);
      if (!getDatabase(id)) throw new Error(t("No such database."));
      await (await import("@/plugins/workspace/pipeline")).startPipeline(id, { ai: false }).done;
    },
  },
];
