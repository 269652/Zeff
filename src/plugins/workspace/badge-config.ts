import { parseColor, type BadgeColor } from "@/lib/badges/palette";
import type { BadgePart } from "./badge-shared";

/**
 * How the Workspace tree's badges look and what they count (Settings → Badges), per account (pref `workspace.badges`,
 * badge-config-store.ts): each kind of mark on or off and in its colour, each source that adds to them on or off. A source off is not
 * counted at all; a kind off is not shown (its parts left out — the tooltips too). Client-safe (pure).
 */

/**
 * The marks: "important" is the dot in a pill (something late or gone wrong) and the ☐ of late todos; "unread" the pill of what
 * waits; "activity" the dot of a change since you last opened a page; "messages" a person's unread messages (✉); "todos" the ☐ pill.
 */
export const WS_TONES = ["unread", "important", "activity", "messages", "todos"] as const;
export type WsTone = (typeof WS_TONES)[number];

/** Where the badges come from (badges.ts). */
export const WS_SOURCES = ["unread", "widgets", "dayLists", "deadlines", "rowTodos", "rowMessages", "rowOther", "activity"] as const;
export type WsSource = (typeof WS_SOURCES)[number];

export type WsBadgeConfig = { tones: Record<WsTone, { on: boolean; color: BadgeColor }>; sources: Record<WsSource, boolean> };

/** As it always looked: what waits indigo, late or gone wrong a red dot, changes an indigo dot, messages teal, todos indigo. */
export const DEFAULT_WS_BADGES: WsBadgeConfig = {
  tones: {
    unread: { on: true, color: "indigo" },
    important: { on: true, color: "red" },
    activity: { on: true, color: "indigo" },
    messages: { on: true, color: "teal" },
    todos: { on: true, color: "indigo" },
  },
  sources: { unread: true, widgets: true, dayLists: true, deadlines: true, rowTodos: true, rowMessages: true, rowOther: true, activity: true },
};

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** A config as stored (anything): every kind and source there, unknown ones dropped, a missing or odd value its default. */
export function parseWsBadges(raw: unknown): WsBadgeConfig {
  const r = obj(raw);
  const tones = obj(r.tones);
  const sources = obj(r.sources);
  const out: WsBadgeConfig = { tones: { ...DEFAULT_WS_BADGES.tones }, sources: { ...DEFAULT_WS_BADGES.sources } };
  for (const id of WS_TONES) {
    const x = obj(tones[id]);
    const def = DEFAULT_WS_BADGES.tones[id];
    out.tones[id] = { on: typeof x.on === "boolean" ? x.on : def.on, color: parseColor(x.color, def.color) };
  }
  for (const id of WS_SOURCES) if (typeof sources[id] === "boolean") out.sources[id] = sources[id] as boolean;
  return out;
}

/**
 * A source's parts as the config lets them through: none when the source is off; a part whose kind is off left out — a late todo with
 * "important" off still counts as an open todo (not marked late); a todo with "todos" off is gone.
 */
export function keepParts(parts: BadgePart[] | null | undefined, source: WsSource, config: WsBadgeConfig): BadgePart[] {
  if (!parts?.length || !config.sources[source]) return [];
  const out: BadgePart[] = [];
  for (const p of parts) {
    if (p.todo) {
      if (!config.tones.todos.on) continue;
      out.push(p.tone === "important" && !config.tones.important.on ? { ...p, tone: "unread" } : p);
      continue;
    }
    if (config.tones[p.tone]?.on === false) continue;
    out.push(p);
  }
  return out;
}

/** Which source a row source's part is (People's: a todo about the person, their unread messages, the rest — promises past their day). */
export const rowPartSource = (p: BadgePart): WsSource => (p.todo ? "rowTodos" : p.tone === "messages" ? "rowMessages" : "rowOther");
