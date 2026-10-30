"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A section that moved to another page: an old link with its anchor (the server never sees it) is sent on — e.g. /settings#hours
 * to /settings/time#hours. `moves`: the anchor (without #) → where it lives now.
 */
export function HashRedirect({ moves }: { moves: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const to = moves[window.location.hash.slice(1)];
    if (to) router.replace(to);
  }, [moves, router]);
  return null;
}
