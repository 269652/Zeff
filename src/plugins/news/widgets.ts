import { t } from "@/lib/i18n/server";
import type { WorkspaceWidget } from "@/plugins/workspace/widget-point";
import { listItems, setState, vote } from "./store";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The best of what is new for you — saved, liked or hidden right there. */
export const NEWS_WIDGETS: WorkspaceWidget[] = [
  {
    id: "news.top",
    label: "News for you",
    icon: "📰",
    description: "The best new items of your news, scored for you — save, like or hide them right here.",
    settings: [{ key: "limit", label: "How many", kind: "number", default: 5, min: 1, max: 15 }],
    ttl: 60,
    data: (config) => {
      const items = listItems({ view: "foryou", limit: 60 })
        .filter((i) => i.state === "new" || i.state === "read")
        .slice(0, Number(config.limit))
        .map((i) => ({
          id: String(i.id),
          text: i.title,
          detail: clip(i.summary, 140),
          badge: i.sourceName,
          href: i.url,
          actions: [
            { id: "save", label: t("Save") },
            { id: "like", label: "👍" },
            { id: "hide", label: t("Hide") },
          ],
        }));
      return { kind: "list", items, empty: t("Nothing new.") };
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
