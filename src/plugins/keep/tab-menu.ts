import type { TabMenuItem } from "../tab-menus-shared";
import { boardDot } from "../kanban/colors";
import { listKeepBoards } from "./boards";
import { keepCount } from "./store";

/** The Keep tab's dropdown: Google Keep and each of your boards — to open directly — and managing them. */
export async function tabMenu(): Promise<TabMenuItem[]> {
  return [
    { href: "/keep/google", label: "Google Keep", hint: `${keepCount()} Notizen`, dot: "bg-yellow-400" },
    ...listKeepBoards().map((b): TabMenuItem => ({ href: `/keep/${b.id}`, label: b.name, hint: `${b.notes} Notizen`, dot: boardDot(b.color) })),
    { href: "/keep/settings", label: "Boards verwalten", hint: "Neue Boards, Google-Konto" },
  ];
}
