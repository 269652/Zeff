/**
 * Wrapping blocks in a container (a panel, a box, a toggle, columns, tabs): what the container is and how it is set up — the
 * choice of a menu, or what the AI made of a sentence ("both side by side in a card titled Revenue"). Pure and client-safe:
 * a plan from the AI is never trusted, it is made one of the five containers with bounded text.
 */

export const CONTAINERS = ["panel", "callout", "toggle", "columns", "tabs"] as const;
export type Container = (typeof CONTAINERS)[number];

export type WrapPlan = {
  container: Container;
  /** A panel's title, a toggle's summary. */
  title?: string;
  /** A panel's description under the title. */
  desc?: string;
  /** A box's colour (blue, green, yellow, red, gray) and icon. */
  tone?: string;
  icon?: string;
  /** Columns (2–4). */
  count?: number;
  /** Tabs' titles, one per block. */
  titles?: string[];
};

export const TONES = ["gray", "blue", "green", "yellow", "red"] as const;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A plan as it is kept; null: not a container we know. */
export function normalizePlan(raw: unknown): WrapPlan | null {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const aliases: Record<string, Container> = { card: "panel", karte: "panel", box: "callout", hinweis: "callout", info: "callout", note: "callout", accordion: "toggle", details: "toggle", aufklapper: "toggle", spalten: "columns", column: "columns", columns: "columns", tab: "tabs", reiter: "tabs" };
  const key = str(o.container, 20).toLowerCase();
  const container = (CONTAINERS as readonly string[]).includes(key) ? (key as Container) : aliases[key];
  if (!container) return null;
  const title = str(o.title, 80);
  const desc = str(o.desc ?? o.description, 300);
  const tone = (TONES as readonly string[]).includes(str(o.tone, 10).toLowerCase()) ? str(o.tone, 10).toLowerCase() : "";
  const icon = str(o.icon, 8);
  const count = Math.floor(Number(o.count));
  const titles = (Array.isArray(o.titles) ? o.titles : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 20);
  return {
    container,
    ...(title ? { title } : {}),
    ...(desc && container === "panel" ? { desc } : {}),
    ...(container === "callout" && tone ? { tone } : {}),
    ...(container === "callout" && icon ? { icon } : {}),
    ...(container === "columns" && count >= 2 ? { count: Math.min(4, count) } : {}),
    ...(container === "tabs" && titles.length ? { titles } : {}),
  };
}
