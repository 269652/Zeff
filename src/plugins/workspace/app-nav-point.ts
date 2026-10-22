import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { NavEntry } from "@/plugins/documents/nav";
import type { Row } from "./model";

/**
 * Plugins' navigations of their app views (the Workspace): the entries a view's sidebar lists, from the database's rows — by app
 * ("documents"). Shown in the view, or under its database in the Workspace tree (app-nav.ts). Server only.
 */
export const appNavProviders = extensionPoint<{ app: string; entries: (rows: Row[]) => NavEntry[] }[]>("workspace.appNav");
