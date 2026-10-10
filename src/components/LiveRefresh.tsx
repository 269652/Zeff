"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** The pages that show runs and todos — they follow the changes they show (not the others'). */
const LIVE: [RegExp, string[]][] = [
  [/^\/$/, ["work", "todos", "attention"]],
  [/^\/work/, ["work", "todos", "branches", "attention"]],
  [/^\/todos/, ["work", "todos", "attention"]],
  [/^\/tickets/, ["work", "todos", "attention"]],
  [/^\/kanban/, ["kanban", "todos"]],
];

/**
 * Follows Zeff's changes (/api/events) and refreshes the page when a run starts or ends or a
 * todo changes — also when an agent did it through the MCP. Only on the pages that show them;
 * a burst of changes is one refresh.
 */
export function LiveRefresh() {
  const router = useRouter();
  const path = usePathname();
  const topics = LIVE.find(([r]) => r.test(path))?.[1].join(",") ?? "";
  useEffect(() => {
    if (!topics) return;
    const wanted = new Set(topics.split(","));
    const source = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener("change", (e) => {
      if (!wanted.has((e as MessageEvent<string>).data)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [topics, router]);
  return null;
}
