import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { WorkspacePackage } from "./packages";

/**
 * Packages plugins give the Workspace: a whole app (pages, databases with their fields and views, blocks, routines) that "New →
 * templates" offers and that is made with one click, and is an ordinary set of pages afterwards. Server only.
 */
export const workspacePackages = extensionPoint<WorkspacePackage[] | (() => WorkspacePackage[])>("workspace.packages");
