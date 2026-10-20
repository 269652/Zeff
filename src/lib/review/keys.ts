import { typing } from "@/lib/palette";

/**
 * The review queue's keys (client-safe): j or ↓ to the next item, k or ↑ to the one before, y answers yes (the
 * item's primary button), n no, e or Enter opens where it lives. Not while typing in a field, not with Ctrl, Cmd
 * or Alt (the browser's and the palette's), and Enter not on a button or a link — that presses it.
 */
export type ReviewKey = "next" | "prev" | "yes" | "no" | "open";

type Press = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | { tagName?: string } | null };

const KEYS: Record<string, ReviewKey> = { j: "next", arrowdown: "next", k: "prev", arrowup: "prev", y: "yes", n: "no", e: "open", enter: "open" };

export function reviewKey(e: Press): ReviewKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return null;
  const key = e.key.toLowerCase();
  if (key === "enter" && ["BUTTON", "A"].includes(((e.target as { tagName?: string } | null)?.tagName ?? "").toUpperCase())) return null;
  return KEYS[key] ?? null;
}
