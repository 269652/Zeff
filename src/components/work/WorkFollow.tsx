"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While workers run (or wait), the page follows them: refreshed every few seconds — states, results, follow-ups. */
export function WorkFollow({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
