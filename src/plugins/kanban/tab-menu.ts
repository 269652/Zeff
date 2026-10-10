import type { TabMenuItem } from "../tab-menus-shared";
import { boardDot } from "./colors";
import { providerBoards } from "./providers";
import { listBoards } from "./store";

/** The Kanban tab's dropdown: every board — yours, then those other plugins bring (Jira Lage) — to open directly. */
export async function tabMenu(): Promise<TabMenuItem[]> {
  const own = listBoards().map((b): TabMenuItem => ({ href: `/kanban/${b.id}`, label: b.name, hint: `${b.open} offen`, dot: boardDot(b.color) }));
  const others = (await providerBoards()).map((b): TabMenuItem => ({ href: b.href, label: b.name, hint: `${b.source} · ${b.open} offen`, dot: boardDot(b.color) }));
  return [...own, ...others, { href: "/kanban", label: "Alle Boards", hint: "Übersicht" }];
}
