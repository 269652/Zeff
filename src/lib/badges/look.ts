import { parseColor, type BadgeColor } from "./palette";

/**
 * The small marks around Zeff besides the Todos tab's badge and the Workspace tree (Settings → Badges), per account (pref
 * `badges.look`, look-store.ts): the Todos page's count of unseen activity, the header's dots — a tab waiting for you (a Work session's
 * question), the ☰ when you are on one of the menu's pages, the Sync button when a sync failed or is unwell. Each on or off, in its
 * colour. Client-safe (pure).
 */

export const LOOK_IDS = ["todoActivity", "waiting", "menu", "syncFailed", "syncUnwell"] as const;
export type LookId = (typeof LOOK_IDS)[number];

export type LookPart = { on: boolean; color: BadgeColor };
export type BadgeLook = Record<LookId, LookPart>;

/** As they always looked. */
export const DEFAULT_LOOK: BadgeLook = {
  todoActivity: { on: true, color: "sky" },
  waiting: { on: true, color: "amber" },
  menu: { on: true, color: "indigo" },
  syncFailed: { on: true, color: "red" },
  syncUnwell: { on: true, color: "amber" },
};

/** A look as stored (anything): every mark there, a missing or odd value its default, unknown ones dropped. */
export function parseLook(raw: unknown): BadgeLook {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LOOK };
  for (const id of LOOK_IDS) {
    const x = (r[id] && typeof r[id] === "object" ? r[id] : {}) as Record<string, unknown>;
    out[id] = { on: typeof x.on === "boolean" ? x.on : DEFAULT_LOOK[id].on, color: parseColor(x.color, DEFAULT_LOOK[id].color) };
  }
  return out;
}
