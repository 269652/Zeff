"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While normalizing runs: the page shown anew every few seconds (how far it is, then its proposals). */
export function Refresh({ running }: { running: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);
  return null;
}
