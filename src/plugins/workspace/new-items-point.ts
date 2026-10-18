import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * What the Workspace's "New" menu offers beside page and database: a plugin contributes entries that make a ready-made database
 * (Notes: a Keep-style board). `create` returns the new page's id. Server only.
 */
export type NewItem = { id: string; icon: string; label: string; create: (parentId: number | null) => number };
export const newItems = extensionPoint<NewItem>("workspace.newItems");
