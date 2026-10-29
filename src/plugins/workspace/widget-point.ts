import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { VNode } from "./card-template";

/**
 * Widgets plugins give the Workspace: a block of a page — or of the dashboard — that shows live data you would otherwise open another
 * app for, with an action right there. A plugin names its widgets, says what can be set (a few options) and gives a function for the
 * data; the Workspace draws every widget alike (a list, or a figure) and keeps the data a moment. Server only.
 */

export type WidgetSetting = { key: string; label: string; kind: "number" | "select" | "text" | "checkbox"; default?: string | number | boolean; min?: number; max?: number; options?: { value: string; label: string }[] };
export type WidgetConfig = Record<string, string | number | boolean>;

export type WidgetItem = {
  id: string;
  text: string;
  detail?: string;
  /** What leads the row: an emoji, or a person's initials (two letters) — none: a quiet dot in its tone. */
  icon?: string;
  /** A short word on the right (a time, "in 3 d", a count). */
  meta?: string;
  /** Where a click on it goes (inside Zeff or out). */
  href?: string;
  badge?: string;
  /** What the badge says: wrong / watch it / fine (its colour). */
  tone?: "good" | "warn" | "bad";
  /** A tick shown (its action "toggle" ticks it). */
  done?: boolean;
  /** The text and detail read whole (wrapped) instead of cut to a line — a sentence that is the point of the row. */
  wrap?: boolean;
  /** A tiny chart under the row: a few bars side by side (two groups' means, a week's days). */
  mini?: { bars: { label: string; value: number; tone?: "good" | "warn" | "bad" }[]; unit?: string };
  /** Buttons on the row, by the action they run on the plugin — shown on hover; with an icon the label is its tooltip. */
  actions?: { id: string; label: string; icon?: string }[];
};

/** A figure of the day: a value with its label, a quiet line under it, a tone (what it says: fine, watch it, wrong), a bar, a link. */
export type WidgetTile = { label: string; value: string; detail?: string; tone?: "good" | "warn" | "bad"; href?: string; bar?: { value: number; max: number } };
/** A card: what a card template made of a row (nodes), where a click goes. */
export type WidgetCard = { id: string; nodes: VNode[]; href?: string };

export type WidgetData =
  | { kind: "stats"; tiles: WidgetTile[] }
  | { kind: "cards"; cards: WidgetCard[]; count?: number; empty?: string; footer?: { text: string; href: string } }
  | { kind: "list"; items: WidgetItem[]; title?: string; /** A number beside the widget's name (unread, open, running). */ count?: number; empty?: string; footer?: { text: string; href: string } }
  | { kind: "figure"; value: string; caption: string; detail?: string; href?: string }
  | { kind: "error"; message: string };

export type WorkspaceWidget = {
  /** "<plugin>.<what>" — unique. */
  id: string;
  label: string;
  icon: string;
  /** One line: what it shows — why it is worth a place on a page. */
  description: string;
  settings?: WidgetSetting[];
  /** false: shown without its header line (its name) — the controls float top right; a block can switch it in its settings. */
  header?: boolean;
  /** How much room it takes on a page: a figure strip is full width, a list half, a small one a third (default: half). */
  size?: "third" | "half" | "full";
  /** Seconds its data is kept (default 30). */
  ttl?: number;
  data: (config: WidgetConfig) => WidgetData | Promise<WidgetData>;
  /** A button of the widget pressed: what the plugin does, and the data after it. Without it the widget has no actions. */
  act?: (action: string, payload: Record<string, string>, config: WidgetConfig) => WidgetData | void | Promise<WidgetData | void>;
};

export const workspaceWidgets = extensionPoint<WorkspaceWidget[]>("workspace.widgets");
