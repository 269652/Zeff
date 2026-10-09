import type { CSSProperties } from "react";

/**
 * Entry types as configured on the Tags page (name + color) — server-free, so client
 * components can render and pick them.
 */
export type EntryTypeDef = { key: string; label: string; color: string; builtin: boolean };

/**
 * Keys the app relies on: imported meetings are "meeting", TimO books "absence" entries in
 * its absence form, and "ticket"/"other" are the defaults. They can be renamed and recolored
 * but not deleted.
 */
export const BUILTIN_TYPE_KEYS = ["ticket", "meeting", "other", "absence", "internal"];

export const FALLBACK_TYPE_COLOR = "#71717a";

/** Types by key, for lookups. */
export function typeMapOf(types: EntryTypeDef[]): Record<string, EntryTypeDef> {
  return Object.fromEntries(types.map((t) => [t.key, t]));
}

/** A type's definition; an unknown key (e.g. a deleted type) shows as itself in grey. */
export function typeDef(map: Record<string, EntryTypeDef>, key: string): EntryTypeDef {
  return map[key] ?? { key, label: key, color: FALLBACK_TYPE_COLOR, builtin: false };
}

/** The type color as a CSS variable — `.badge-type` and charts derive their tints from it. */
export function typeColorStyle(color: string): CSSProperties {
  return { "--type-color": color } as CSSProperties;
}
