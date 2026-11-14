/**
 * What the Explorer registers (loaded with the other plugins' server modules, contributions.ts): its screen on its own pages in
 * the Workspace, the template "Explorer" under New → templates, and the live watchers of the watched folders.
 */
import { createElement } from "react";
import { t } from "@/lib/i18n/server";
import { pageNavProviders } from "@/plugins/workspace/app-nav-point";
import { workspacePageApps, workspaceTemplates } from "@/plugins/workspace/page-apps-point";
import { createExplorerPage, isExplorerPage, pagesWithPlacesInTree } from "./pages";
import { startWatching } from "./watch";

// An Explorer page: the Explorer above its text, in the folder it was last in.
workspacePageApps.contribute("explorer", {
  async app(pageId) {
    if (!isExplorerPage(pageId)) return null;
    const { explorerStart } = await import("./start");
    const { ExplorerApp } = await import("./ui/ExplorerApp");
    return createElement(ExplorerApp, { pageId, start: await explorerStart(pageId) });
  },
});

// "New → templates": an Explorer of its own (each page remembers its folder).
workspaceTemplates.contribute("explorer", [
  {
    key: "explorer",
    get name() {
      return t("Explorer");
    },
    icon: "🗂️",
    get description() {
      return t("The files of this computer, like Windows Explorer: import them into Documents, watch folders, open and edit files.");
    },
    kind: "page",
    build: (parentId) => createExplorerPage(parentId),
  },
]);

// The places of an Explorer page that keeps them in the Workspace tree: under the page there, each opening its folder (?nav=path:…).
pageNavProviders.contribute("explorer", {
  async navs() {
    const pages = pagesWithPlacesInTree();
    if (!pages.length) return [];
    const { places } = await import("./files");
    const { navIdOf } = await import("./shared");
    const p = places();
    const entries = [
      ...p.quick.map((x) => ({ id: navIdOf(x.path), label: x.name, icon: x.icon, n: 0, group: t("Quick access") })),
      ...p.watched.map((x) => ({ id: navIdOf(x.path), label: x.name, icon: x.icon, n: 0, group: t("Watched folders") })),
      ...p.drives.map((x) => ({ id: navIdOf(x.path), label: x.name, icon: x.icon, n: 0, group: t("This PC") })),
    ];
    return pages.map((pageId) => ({ pageId, entries }));
  },
});

startWatching();
