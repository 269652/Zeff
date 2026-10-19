"use client";

import { useEffect } from "react";
import { pollWhileVisible } from "@/lib/poll-visible";

/**
 * While the lock is on: asks /api/lock every few seconds — only in the tab you look at — whether this browser is still unlocked. The moment it is not (the key
 * was pulled, "Lock now" somewhere) the page goes blank and reloads — the proxy answers with the lock page. Nothing renders.
 */
export function LockWatcher({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const look = async () => {
      try {
        const res = await fetch("/api/lock", { cache: "no-store" });
        const s = (await res.json()) as { locked?: boolean };
        if (!stop && s.locked) {
          stop = true;
          document.documentElement.style.visibility = "hidden";
          location.reload();
        }
      } catch {
        // the server is away: nothing to decide
      }
    };
    // (Every tab asking every second, hidden ones too, was a constant load on the server: now one in view, every 3 s.)
    const end = pollWhileVisible(() => void look(), 3000);
    return () => {
      stop = true;
      end();
    };
  }, [enabled]);
  return null;
}
