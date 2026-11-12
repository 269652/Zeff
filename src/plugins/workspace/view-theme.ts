/**
 * Theming of a view: <theme accent="#0ea5e9" radius="lg" font="serif"/> recolours the view's accent (the indigo of buttons, links, chips),
 * rounds or squares its corners and sets its font — as CSS variables on the view's own box, so nothing outside it changes and dark mode
 * still works. Client-safe.
 */
export type ThemeAttrs = { accent?: string; radius?: string; font?: string };

const mix = (c: string, other: "white" | "black", pct: number) => `color-mix(in oklab, ${c} ${pct}%, ${other})`;

const RADIUS: Record<string, [string, string, string, string]> = {
  none: ["0", "0", "0", "0"],
  sm: ["0.125rem", "0.25rem", "0.375rem", "0.5rem"],
  lg: ["0.375rem", "0.625rem", "0.875rem", "1.25rem"],
};
const FONT: Record<string, string> = { serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif", mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };

/** The CSS variables a theme sets (only the ones it says). */
export function themeStyle(t: ThemeAttrs): Record<string, string> {
  const s: Record<string, string> = {};
  if (t.accent && /^#[0-9a-f]{6}$/i.test(t.accent)) {
    const a = t.accent;
    Object.assign(s, {
      "--color-indigo-50": mix(a, "white", 8),
      "--color-indigo-100": mix(a, "white", 16),
      "--color-indigo-200": mix(a, "white", 32),
      "--color-indigo-300": mix(a, "white", 55),
      "--color-indigo-400": mix(a, "white", 78),
      "--color-indigo-500": a,
      "--color-indigo-600": a,
      "--color-indigo-700": mix(a, "black", 82),
      "--color-indigo-800": mix(a, "black", 66),
      "--color-indigo-900": mix(a, "black", 50),
      "--color-indigo-950": mix(a, "black", 32),
    });
  }
  const r = t.radius ? RADIUS[t.radius] : undefined;
  if (r) Object.assign(s, { "--radius-sm": r[0], "--radius-md": r[1], "--radius-lg": r[2], "--radius-xl": r[3] });
  if (t.font && FONT[t.font]) s.fontFamily = FONT[t.font];
  return s;
}
