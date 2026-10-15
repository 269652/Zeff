"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** The pages that show runs and todos — they follow the changes they show (not the others'). */
const LIVE: [RegExp, string[]][] = [
  [/^\/$/, ["work", "todos", "attention"]],
  [/^\/work/, ["work", "todos", "attention"]],
  [/^\/todos/, ["work", "todos", "attention"]],
  [/^\/tickets/, ["work", "todos", "attention"]],
  [/^\/kanban/, ["kanban", "todos"]],
  [/^\/t\//, ["work", "todos", "attention"]],
  [/^\/heute/, ["work", "todos", "attention"]],
];

/**
 * Follows Zeff's changes (/api/events) and refreshes the page when a run starts or ends or a
 * todo changes — also when an agent did it through the MCP. Only on the pages that show them.
 * A burst of changes is one refresh, and refreshes are at least {@link MIN_GAP} apart: a worker that
 * changes things all the time (a run streaming) must not make the page render again and again — each
 * refresh renders the whole page on the server. In a tab nobody looks at, the refresh waits until it is shown.
 */
const MIN_GAP = 3000;

export function LiveRefresh() {
  const router = useRouter();
  const path = usePathname();
  const topics = LIVE.find(([r]) => r.test(path))?.[1].join(",") ?? "";
  useEffect(() => {
    if (!topics) return;
    const wanted = new Set(topics.split(","));
    const source = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let stale = false;
    const refresh = () => {
      timer = null;
      if (document.visibilityState === "hidden") {
        stale = true; // when the tab is shown again
        return;
      }
      stale = false;
      last = Date.now();
      router.refresh();
    };
    const schedule = () => {
      if (timer) return; // one is already waiting: it covers this change too
      timer = setTimeout(refresh, Math.max(400, last + MIN_GAP - Date.now()));
    };
    const shown = () => {
      if (document.visibilityState === "visible" && stale) schedule();
    };
    source.addEventListener("change", (e) => {
      if (wanted.has((e as MessageEvent<string>).data)) schedule();
    });
    document.addEventListener("visibilitychange", shown);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      source.close();
    };
  }, [topics, router]);
  return null;
}
