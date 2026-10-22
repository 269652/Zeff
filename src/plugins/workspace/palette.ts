import type { PaletteItem } from "@/lib/palette";
import { t } from "@/lib/i18n/server";
import { afterSyncPlan } from "./pipeline";
import { WAITING, stateOf, type JobState } from "./jobs";
import { listRoutines } from "./routines";
import { getDatabase, rawRows, tree } from "./store";

/**
 * What the command palette (Ctrl/⌘+K) can do in the Workspace: a new page or database, a pipeline refreshed. Their href is
 * "zeff:<what>" — the palette runs it instead of opening a page. Server only (the route filters them with the pages).
 */
export function workspacePaletteItems(): PaletteItem[] {
  const group = "Actions";
  const items: PaletteItem[] = [
    { id: "ws:new-page", label: `＋ ${t("New page")}`, hint: t("In the Workspace"), href: "zeff:new-page", group, keywords: "new page create neue seite anlegen erstellen notiz note" },
    { id: "ws:new-database", label: `＋ ${t("New database")}`, hint: t("In the Workspace"), href: "zeff:new-database", group, keywords: "new database create neue datenbank anlegen erstellen tabelle table board" },
  ];
  for (const { id } of afterSyncPlan()) {
    const d = getDatabase(id);
    if (!d || d.page.archivedAt) continue;
    items.push({ id: `ws:refresh:${id}`, label: `↻ ${t("Refresh")} “${d.page.title || t("Untitled")}”`, hint: t("Read its sources, run its AI"), href: `zeff:refresh:${id}`, group, keywords: `refresh run pipeline aktualisieren neu lesen starten ${d.page.title}` });
  }
  return items;
}

/**
 * Everything of the Workspace the commands palette (Ctrl/⌘+Shift+K) runs by hand: the actions above, every routine (an agent
 * or an automation — on or off, a manual run is always yours), each waiting job of a jobs database and "all open jobs" of it.
 */
export function workspaceCommandItems(): PaletteItem[] {
  const items = workspacePaletteItems();
  for (const r of listRoutines()) {
    const agent = r.kind === "agent";
    items.push({
      id: `ws:routine:${r.pageId}`,
      label: `▶ ${r.title || t("Untitled")}`,
      hint: `${agent ? t("Start the agent") : t("Run the automation")}${r.enabled ? "" : ` · ${t("off")}`}`,
      href: `zeff:routine:${r.pageId}`,
      group: agent ? "Agents" : "Automations",
      keywords: `run start routine ausführen starten ${agent ? "agent agenten" : "automation automatisierung"}`,
    });
  }
  for (const x of tree()) {
    if (x.kind !== "database") continue;
    const d = getDatabase(x.id);
    if (!d?.schema.jobs || d.page.archivedAt) continue;
    const name = d.page.title || t("Untitled");
    const waiting = rawRows(x.id).filter((r) => WAITING.includes(stateOf(r.id) as JobState));
    if (!waiting.length) continue;
    items.push({ id: `ws:jobs:${x.id}`, label: `▶ ${t("Start all open jobs")} “${name}”`, hint: t("{n} waiting", { n: waiting.length }), href: `zeff:jobs:${x.id}`, group: "Jobs", keywords: `run start all jobs aufträge alle starten ${name}` });
    for (const r of waiting) items.push({ id: `ws:job:${r.id}`, label: `▶ ${r.title || t("Untitled")}`, hint: `${t("Start the job")} · ${name}`, href: `zeff:job:${r.id}`, group: "Jobs", keywords: "run start job auftrag starten" });
  }
  return items;
}
