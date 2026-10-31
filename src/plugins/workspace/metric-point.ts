import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * Kennzahlen plugins give the Workspace: a number that plugin knows (the Finances plugin's Tilgungsrate and Schuldenstand,
 * the hours booked this week, the open promises) under a name every part of Zeff can read — kennzahl("Tilgungsrate") in a
 * formula, @Tilgungsrate in a page, metric_get for an agent. The plugin gives how to read it now; the Workspace keeps its
 * history, goals and thresholds (metrics.ts). A Kennzahl of the same name you made yourself wins. Server only.
 */
export type MetricProvider = {
  /** The name it is read by ("Tilgungsrate"). */
  label: string;
  /** "€", "€/Monat", "%", "h", "Monate" … */
  unit: string;
  /** One line: what it is. */
  what: string;
  /** Its value now (this account's) — null: not known (nothing to read yet). */
  read: () => number | null;
  /** Where the user sees what it is made of (read when shown). */
  href?: () => string | undefined;
  /** What a value says by itself (an overdue count above zero: wrong) — a goal or threshold set on it decides first. */
  tone?: (value: number) => "good" | "warn" | "bad" | undefined;
  /** Whether it is there at all, cheap to ask (the merge requests: only with a source of them) — false: not listed. */
  available?: () => boolean;
};

/** A plugin's Kennzahlen: a list, or one read when asked (one per thing of yours: each day list's). */
export const workspaceMetrics = extensionPoint<MetricProvider[] | (() => MetricProvider[])>("workspace.metrics");
