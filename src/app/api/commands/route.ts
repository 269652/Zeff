import { connection } from "next/server";
import type { PaletteItem } from "@/lib/palette";

/**
 * The commands palette's list (Ctrl/⌘+Shift+K): everything Zeff runs by hand — each sync step and "sync all", the
 * Workspace's actions, routines (agents, automations) and waiting jobs. All of it at once: the palette filters as you type.
 * Each href is "zeff:<what>:<arg>" — the palette runs it instead of opening a page.
 */
export async function GET() {
  await connection();
  const items: PaletteItem[] = [];
  try {
    const { t } = await import("@/lib/i18n/server");
    const { syncOverview } = await import("@/lib/sync/registry");
    const o = syncOverview();
    items.push({ id: "sync:all", label: `↻ ${t("Sync all")}`, hint: o.all.running ? t("running") : t("Every step, one after the other"), href: "zeff:sync-all", group: "Sync", keywords: "sync all alles synchronisieren abgleichen" });
    for (const s of o.steps) {
      const hint = s.running ? t("running") : s.what;
      items.push({ id: `sync:${s.key}`, label: `↻ ${s.label}`, hint, href: `zeff:sync:${s.key}`, group: "Sync", keywords: `sync synchronisieren abgleichen ${s.key}` });
    }
  } catch (e) {
    console.error("[commands] sync", e);
  }
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("workspace")) items.push(...(await import("@/plugins/workspace/palette")).workspaceCommandItems());
  } catch (e) {
    console.error("[commands] workspace", e);
  }
  return Response.json({ items });
}
