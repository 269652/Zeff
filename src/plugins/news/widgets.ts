import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { clip, initials } from "@/plugins/workspace/widget-shared";
import { listItems, setState, vote } from "./store";

/** The best of what is new for you — saved, liked or hidden right there. */
export const NEWS_WIDGETS: WorkspaceWidget[] = [
  {
    id: "news.top",
    get label() {
      return t("News for you");
    },
    icon: "📰",
    get description() {
      return t("The best new items of your news, scored for you — save, like or hide them right here.");
    },
    get settings(): WidgetSetting[] {
      return [{ key: "limit", label: t("How many"), kind: "number", default: 6, min: 1, max: 15 }];
    },
    ttl: 60,
    data: (config) => {
      const items = listItems({ view: "foryou", limit: 60 })
        .filter((i) => i.state === "new" || i.state === "read")
        .slice(0, Number(config.limit))
        .map((i) => ({
          id: String(i.id),
          icon: initials(i.sourceName) || "📰",
          text: i.title,
          detail: [i.sourceName, clip(i.summary, 110)].filter(Boolean).join(" — "),
          meta: i.publishedAt ? formatAgo(i.publishedAt) : undefined,
          href: i.url,
          actions: [
            { id: "save", label: t("Save"), icon: "🔖" },
            { id: "like", label: t("More like this"), icon: "👍" },
            { id: "hide", label: t("Hide"), icon: "✕" },
          ],
        }));
      return { kind: "list", items, empty: t("Nothing new."), footer: { text: t("All news"), href: "/news" } };
    },
    act: (action, payload) => {
      const id = Number(payload.id);
      if (action === "save") setState(id, "saved");
      else if (action === "like") vote(id, 1);
      else if (action === "hide") setState(id, "hidden");
      else throw new Error("unknown action");
    },
  },
];
