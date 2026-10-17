import { extensionPoint } from "@/lib/plugin-kit/extension-point";

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
  /** Where a click on it goes (inside Zeff or out). */
  href?: string;
  badge?: string;
  /** A tick shown (its action "toggle" ticks it). */
  done?: boolean;
  /** Buttons on the row, by the action they run on the plugin. */
  actions?: { id: string; label: string }[];
};

export type WidgetData =
  | { kind: "list"; items: WidgetItem[]; title?: string; empty?: string; footer?: { text: string; href: string } }
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
  /** Seconds its data is kept (default 30). */
  ttl?: number;
  data: (config: WidgetConfig) => WidgetData | Promise<WidgetData>;
  /** A button of the widget pressed: what the plugin does, and the data after it. Without it the widget has no actions. */
  act?: (action: string, payload: Record<string, string>, config: WidgetConfig) => WidgetData | void | Promise<WidgetData | void>;
};

export const workspaceWidgets = extensionPoint<WorkspaceWidget[]>("workspace.widgets");
