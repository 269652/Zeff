import { collectionProviders } from "@/lib/items/point";
import { tabMenus } from "../tab-menus-point";
import { keepCollections } from "./collections";

/** What Keep registers for the shell and other plugins (loaded through plugins/contributions). */
tabMenus.contribute("keep", { tab: "/keep", items: async () => (await import("./tab-menu")).tabMenu() });
collectionProviders.contribute("keep", keepCollections);
