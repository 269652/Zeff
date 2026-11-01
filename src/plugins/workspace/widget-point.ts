import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { VNode } from "./card-template";
import type { BadgePart } from "./badge-shared";

/**
 * Widgets plugins give the Workspace: a block of a page — or of the dashboard — that shows live data you would otherwise open another
 * app for, with an action right there. A plugin names its widgets, says what can be set (a few options) and gives a function for the
 * data; the Workspace draws every widget alike (a list, or a figure) and keeps the data a moment. Server only.
 */

export type WidgetSetting = { key: string; label: string; /** person: a name picked from the people (its id kept as `<key>Id`). */ kind: "number" | "select" | "text" | "checkbox" | "person"; default?: string | number | boolean; min?: number; max?: number; options?: { value: string; label: string }[]; /** Kept in the config but not shown in the settings (what a migration set: an old block's picks). */ hidden?: boolean };
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
  | { kind: "list"; items: WidgetItem[]; title?: string; /** A number beside the widget's name (unread, open, running). */ count?: number; /** How many of all (not only those shown) are wrong — past their day: what the page's badge counts as important (none: the shown items in tone "bad"). */ urgent?: number; empty?: string; footer?: { text: string; href: string } }
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
  /** What else its data depends on, cheap to read (kept data is for the same answer only) — the widgets beside it on its page. */
  cacheKey?: (config: WidgetConfig) => string | Promise<string>;
  data: (config: WidgetConfig) => WidgetData | Promise<WidgetData>;
  /**
   * What the page it stands on shows in the Workspace tree (a pill: "2", red when important): made of its data (the same, kept as
   * long) — open todos about a person, unread mail, a figure gone wrong. Cheap, never an AI. Without it the widget adds nothing.
   */
  badge?: (config: WidgetConfig, data: WidgetData) => BadgePart[] | null | Promise<BadgePart[] | null>;
  /** A button of the widget pressed: what the plugin does, and the data after it. Without it the widget has no actions. */
  act?: (action: string, payload: Record<string, string>, config: WidgetConfig) => WidgetData | void | Promise<WidgetData | void>;
};

export const workspaceWidgets = extensionPoint<WorkspaceWidget[]>("workspace.widgets");

/** The badge of a list widget: its shown items in tone "bad" (or its `urgent`) as important, its `count` as unread — each only with a label for it. */
export function listBadge(labels: { important?: (n: number) => string; unread?: (n: number) => string; activity?: (n: number) => string; /** Its rows are todos: counted in the todo pill. */ todo?: boolean }): (config: WidgetConfig, data: WidgetData) => BadgePart[] | null {
  return (_config, data) => {
    if (data.kind !== "list") return null;
    const bad = data.urgent ?? data.items.filter((i) => i.tone === "bad").length;
    const n = data.count ?? 0;
    const out: BadgePart[] = [];
    const todo = labels.todo ? { todo: true } : {};
    if (labels.important && bad > 0) out.push({ tone: "important", count: bad, label: labels.important(bad), ...todo });
    // (The important ones are among the count: counted once — the pill shows all that waits, the red dot how much is late.)
    const rest = labels.important ? Math.max(0, n - bad) : n;
    if (labels.unread && rest > 0) out.push({ tone: "unread", count: rest, label: labels.unread(n), ...todo });
    if (labels.activity && n > 0) out.push({ tone: "activity", count: n, label: labels.activity(n) });
    return out;
  };
}

/** The badge of a figures widget: a figure gone wrong (tone "bad") is important — one each. */
export function statsBadge(label: (tile: string) => string): (config: WidgetConfig, data: WidgetData) => BadgePart[] | null {
  return (_config, data) => (data.kind === "stats" ? data.tiles.filter((x) => x.tone === "bad").map((x) => ({ tone: "important" as const, count: 1, label: label(x.label) })) : null);
}
