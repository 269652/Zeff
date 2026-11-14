import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { NavEntry } from "@/plugins/documents/nav";
import type { Row } from "./model";

/**
 * Plugins' navigations of their app views (the Workspace): the entries a view's sidebar lists, from the database's rows — by app
 * ("documents"). Shown in the view, or under its database in the Workspace tree (app-nav.ts). Server only.
 */
export const appNavProviders = extensionPoint<{ app: string; entries: (rows: Row[]) => NavEntry[] }[]>("workspace.appNav");

/**
 * Plugins' navigations of their own pages (not a database's view): entries shown under the page in the Workspace tree — the Explorer's
 * places under an Explorer page. An entry without `href` leads to the page with `?nav=<id>`, which the plugin's page app reads; the
 * plugin decides which pages have one (its own setting) — the tree offers no "Hide" for them. Server only.
 */
export type PageNav = { pageId: number; entries: (NavEntry & { href?: string })[] };
export const pageNavProviders = extensionPoint<{ navs: () => PageNav[] | Promise<PageNav[]> }>("workspace.pageNav");
