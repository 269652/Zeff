/** WCAG contrast for text on a user-chosen colour (a calendar's): black or white, whichever reads better. Client-safe. */

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** "#abc" / "#aabbcc" (an alpha ignored) as [r,g,b]; null for anything else. */
export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance (0 black .. 1 white). */
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour for a background: #111 or #fff, the one with more contrast (an unreadable colour: white). */
export function textOn(background: string): "#111111" | "#ffffff" {
  const rgb = parseHex(background);
  if (!rgb) return "#ffffff";
  return contrastRatio(rgb, [17, 17, 17]) > contrastRatio(rgb, [255, 255, 255]) ? "#111111" : "#ffffff";
}
