import type { ReactNode } from "react";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * Page apps: what a plugin shows on a page of the Workspace above its text, when the page is one of its own — a learning space
 * (a page holding Learn's databases) shows its courses and "Learn something new". The plugin tells it from the page (its
 * children, its kind); null: not its page. The first that answers wins (page-apps.ts). Server only.
 */
export type PageApp = { app(pageId: number): Promise<ReactNode | null> | ReactNode | null };
export const workspacePageApps = extensionPoint<PageApp>("workspace.pageApps");

/**
 * Templates a plugin brings, made by its code (not a package of pages): offered with the built-in ones under "New → templates" —
 * Learn's "Learning space". `build` makes it under `parentId` and gives its page's id.
 */
export type PluginTemplate = { key: string; name: string; icon: string; description: string; kind: "page" | "database"; build: (parentId: number | null) => number };
export const workspaceTemplates = extensionPoint<PluginTemplate[]>("workspace.templates");
