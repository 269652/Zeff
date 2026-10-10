/** Format hours as a compact decimal, e.g. 1.5, 2, 0.25. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0";
  return (Math.round(hours * 100) / 100)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

/** Round to 2 decimals so 0.1 + 0.2 style sums stay tidy. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
