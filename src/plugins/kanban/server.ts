import { apiPoint } from "@/lib/plugins/api-point";
import { collectionProviders } from "@/lib/items/point";
import { tabMenus } from "../tab-menus-point";
import { KANBAN_API } from "./api";
import { kanbanCollections } from "./collections";

/** What Kanban registers for other plugins and the shell (loaded through plugins/contributions). */
apiPoint.contribute("kanban", KANBAN_API);
tabMenus.contribute("kanban", { tab: "/kanban", items: async () => (await import("./tab-menu")).tabMenu() });
collectionProviders.contribute("kanban", kanbanCollections);
