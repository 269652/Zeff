import Link from "next/link";
import { boardDot } from "@/plugins/kanban/colors";
import { listKeepBoards } from "./boards";
import { keepCount } from "./store";

/** Keep's sources in the sidebar: Google Keep and your boards — the one open marked — and where to manage them. */
export function KeepNav({ current }: { current: "google" | number | "settings" }) {
  const boards = listKeepBoards();
  const item = (active: boolean) => `flex items-baseline gap-2 rounded px-2 py-1 ${active ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`;
  return (
    <nav className="flex flex-col gap-0.5 text-sm" aria-label="Keep-Quellen">
      <Link href="/keep/google" aria-current={current === "google" ? "page" : undefined} className={item(current === "google")}>
        <span className="size-2 shrink-0 rounded-full bg-yellow-400" />
        <span className="truncate">Google Keep</span>
        <span className="ml-auto text-xs text-zinc-400">{keepCount()}</span>
      </Link>
      {boards.map((b) => (
        <Link key={b.id} href={`/keep/${b.id}`} aria-current={current === b.id ? "page" : undefined} className={item(current === b.id)}>
          <span className={`size-2 shrink-0 rounded-full ${boardDot(b.color)}`} />
          <span className="truncate">{b.name}</span>
          <span className="ml-auto text-xs text-zinc-400">{b.notes}</span>
        </Link>
      ))}
      <Link href="/keep/settings" aria-current={current === "settings" ? "page" : undefined} className={`${item(current === "settings")} text-zinc-500`}>
        + Boards verwalten
      </Link>
    </nav>
  );
}
