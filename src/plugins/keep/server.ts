import { collectionProviders } from "@/lib/items/point";
import { tabMenus } from "../tab-menus-point";
import { newItems } from "../workspace/new-items-point";
import { createNotesBoard } from "./to-workspace";
import { keepCollections } from "./collections";

/** What Keep registers for the shell and other plugins (loaded through plugins/contributions). */
tabMenus.contribute("notes", { tab: "/keep", items: async () => (await import("./tab-menu")).tabMenu() });
collectionProviders.contribute("notes", keepCollections);
newItems.contribute("notes", { id: "keep-board", icon: "🗒️", label: "Keep board", create: (parentId) => createNotesBoard(parentId) });
