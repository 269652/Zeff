"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While workers run (or wait), the page follows them. Their changes (a run starting or ending, todos)
 * refresh it at once (LiveRefresh); this is the fallback for the rest — every 15 s, not every 3: each
 * refresh renders the whole page on the server.
 */
export function WorkFollow({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
