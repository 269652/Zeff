import { tabMenus } from "../tab-menus-point";

/** What Keep registers for the shell (loaded through plugins/contributions). */
tabMenus.contribute("keep", { tab: "/keep", items: async () => (await import("./tab-menu")).tabMenu() });
