import "@/plugins/contributions";
import type { ReactNode } from "react";
import { workspacePageApps } from "./page-apps-point";

/** What a plugin shows on this page (null: nothing). A plugin that fails is skipped (logged) — the page still opens. Server only. */
export async function pageApp(pageId: number): Promise<ReactNode | null> {
  for (const c of workspacePageApps.list()) {
    try {
      const node = await c.impl.app(pageId);
      if (node) return node;
    } catch (e) {
      console.error(`[workspace] ${c.plugin}'s page app failed on page ${pageId}`, e);
    }
  }
  return null;
}
