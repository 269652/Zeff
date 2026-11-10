/**
 * The badge on the Todos tab (the header, the phone's bar): which numbers it shows — your open todos, the late ones, the
 * ones due today, the activity you haven't seen — in which order, each in its colour. Set under Settings → Badges,
 * kept per account (its pref, todos/badge-store.ts). Client-safe (pure).
 */

import { parseColor, type BadgeColor } from "@/lib/badges/palette";

export const BADGE_PARTS = ["open", "late", "today", "activity"] as const;
export type BadgePartId = (typeof BADGE_PARTS)[number];

export { BADGE_COLORS, BADGE_TONES, type BadgeColor } from "@/lib/badges/palette";

export type BadgePart = { id: BadgePartId; on: boolean; color: BadgeColor };
export type BadgeConfig = BadgePart[];

/** As it was: the open ones (indigo), the unseen activity — calm sky now, not a loud red. Late and today off. */
export const DEFAULT_BADGE: BadgeConfig = [
  { id: "open", on: true, color: "indigo" },
  { id: "late", on: false, color: "red" },
  { id: "today", on: false, color: "amber" },
  { id: "activity", on: true, color: "sky" },
];

/** A config as stored (anything): every part once, known ids and colours, missing ones added at the end as the default has them. */
export function parseBadge(raw: unknown): BadgeConfig {
  const list = Array.isArray(raw) ? raw : [];
  const out: BadgeConfig = [];
  for (const x of list) {
    const o = (x ?? {}) as Partial<BadgePart>;
    if (!o.id || !BADGE_PARTS.includes(o.id) || out.some((p) => p.id === o.id)) continue;
    const def = DEFAULT_BADGE.find((p) => p.id === o.id)!;
    out.push({ id: o.id, on: typeof o.on === "boolean" ? o.on : def.on, color: parseColor(o.color, def.color) });
  }
  for (const d of DEFAULT_BADGE) if (!out.some((p) => p.id === d.id)) out.push({ ...d });
  return out;
}

export type BadgeCounts = { open: number; late: number; today: number; activity: number };

/** The segments to draw: the parts switched on that have a number, in their order. */
export const badgeSegments = (config: BadgeConfig, counts: BadgeCounts): { id: BadgePartId; n: number; color: BadgeColor }[] =>
  config.filter((p) => p.on && counts[p.id] > 0).map((p) => ({ id: p.id, n: counts[p.id], color: p.color }));
